import io
import re

import boto3
import pdfplumber

from rubric_locator import attach_sources

# the questionnaire generator: a rubric pdf in, a structured questionnaire out.
# sonnet STRUCTURES the rubric, it does not rewrite it — every option label is
# lifted verbatim, and we verify that. numeric criteria (gpa bands) are tagged so
# the caller routes them to code, not the llm.

MODEL = "us.anthropic.claude-opus-4-8"

_bedrock = None


def bedrock():
    global _bedrock
    if _bedrock is None:
        _bedrock = boto3.client("bedrock-runtime", region_name="us-west-2")
    return _bedrock


def extract_text(pdf_bytes: bytes) -> str:
    parts = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as f:
        for page in f.pages:
            for table in page.extract_tables():
                for row in table:
                    parts.append(
                        " | ".join((cell or "").replace("\n", " ").strip() for cell in row)
                    )
            parts.append(page.extract_text() or "")
    return "\n".join(parts)


# one option = a score the SYSTEM knows and the description the AGENT reads. the
# agent picks by label and never sees the number, so grading stays deterministic.
_OPTION = {
    "type": "object",
    "properties": {
        "score": {"type": "number", "description": "the score for this level; if the rubric gives a range (e.g. 'Excellent (3-4)'), the LOW end"},
        "score_max": {"type": "number", "description": "only when the rubric gives a score RANGE for this level: the high end (e.g. 4 for 'Excellent (3-4)'). Omit for single-score levels."},
        "label": {"type": "string", "description": "the option description, VERBATIM from the rubric, no rewording"},
    },
    "required": ["score", "label"],
}

SCHEMA = {
    "type": "object",
    "properties": {
        "rubric_name": {"type": "string"},
        "scale_note": {"type": "string", "description": "e.g. '0-5 per criterion, unweighted'"},
        "criteria": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "short topic label for navigation, verbatim (e.g. 'Career Goals')"},
                    "question": {"type": "string", "description": "the actual question the reviewer answers. Copy the rubric's instruction/prompt text verbatim if it has one; if the rubric gives only a topic, write the question that topic is asking."},
                    "type": {
                        "type": "string",
                        "enum": ["options", "scale", "variants", "boolean"],
                        "description": "options = the rubric gives a distinct description per score (anchored levels), agent picks one; scale = a question plus a numeric range (e.g. 'Score 0-10') with NO per-score descriptions, agent returns a number; variants = one criterion whose scoring table changes by applicant category (e.g. GPA bands per student level), agent picks the category then a band; boolean = yes/no gate (e.g. 'score 0 if AI-written')",
                    },
                    "weight": {"type": "string", "description": "weight if the rubric gives one, else empty"},
                    "min": {"type": "number", "description": "scale type only: lowest score on the range"},
                    "max": {"type": "number", "description": "scale type only: highest score on the range"},
                    "options": {
                        "type": "array",
                        "description": "for options / boolean types",
                        "items": _OPTION,
                    },
                    "variants": {
                        "type": "array",
                        "description": "for the variants type: one entry per applicant category, each with its own option table",
                        "items": {
                            "type": "object",
                            "properties": {
                                "level": {"type": "string", "description": "the applicant category this table applies to, VERBATIM (e.g. 'Incoming Frosh')"},
                                "options": {"type": "array", "items": _OPTION},
                            },
                            "required": ["level", "options"],
                        },
                    },
                },
                "required": ["name", "question", "type"],
            },
        },
    },
    "required": ["rubric_name", "criteria"],
}


def _generate(text: str) -> dict:
    tool = {
        "toolSpec": {
            "name": "emit_questionnaire",
            "description": "Emit the structured questionnaire.",
            "inputSchema": {"json": SCHEMA},
        }
    }
    msg = (
        "Convert this scholarship rubric into a structured questionnaire for scoring agents. "
        "One entry per criterion (per row of the rubric). For each criterion, choose its TYPE:\n"
        "- 'options': the rubric gives a distinct description for each score (anchored levels). List every score with its NUMBER and its description.\n"
        "- 'scale': the rubric gives a QUESTION plus a numeric range (e.g. 'Score 0-10') but NO per-score descriptions. Set min and max, do NOT invent options.\n"
        "- 'variants': one criterion whose scoring table changes by applicant category (e.g. GPA bands that differ for Incoming Frosh vs Transfer vs MS Student). Emit ONE criterion with a 'variants' list; each variant has its 'level' (the category label, verbatim) and its own options. Do NOT split it into separate criteria.\n"
        "- 'boolean': a yes/no gate (e.g. 'score 0 if AI-written').\n"
        "For every criterion also give 'name' (the short topic label, verbatim) and 'question' (the actual question the reviewer answers - copy the rubric's instruction/prompt verbatim if it has one, otherwise write the question the topic is asking). "
        "Copy all option descriptions and level labels VERBATIM from the rubric text - do not paraphrase, summarize, or fix grammar. "
        "If the rubric assigns a score RANGE to a level (e.g. 'Excellent (3-4)'), set score to the low end and score_max to the high end - never collapse a range to one number.\n\n"
        f"RUBRIC TEXT:\n{text}"
    )
    resp = bedrock().converse(
        modelId=MODEL,
        messages=[{"role": "user", "content": [{"text": msg}]}],
        toolConfig={"tools": [tool], "toolChoice": {"tool": {"name": "emit_questionnaire"}}},
        inferenceConfig={"maxTokens": 3000},  # opus 4.8 rejects temperature
    )
    for block in resp["output"]["message"]["content"]:
        if "toolUse" in block:
            return block["toolUse"]["input"]
    raise RuntimeError("model did not return a questionnaire")


# every option label, whether it sits on the criterion or inside a variant table
def _all_options(criterion: dict) -> list[dict]:
    opts = list(criterion.get("options") or [])
    for variant in criterion.get("variants") or []:
        opts += variant.get("options") or []
    return opts


def _verbatim_check(questionnaire: dict, source: str) -> tuple[int, int]:
    src = re.sub(r"\s+", " ", source).lower()
    total = ok = 0
    for criterion in questionnaire["criteria"]:
        for option in _all_options(criterion):
            total += 1
            label = re.sub(r"\s+", " ", option["label"]).lower().strip()
            probe = label if len(label) <= 60 else label[:60]
            if probe and probe in src:
                ok += 1
    return ok, total


def generate_from_pdf(pdf_bytes: bytes) -> dict:
    text = extract_text(pdf_bytes)
    questionnaire = _generate(text)
    ok, total = _verbatim_check(questionnaire, text)
    questionnaire["verbatim_matched"] = ok
    questionnaire["verbatim_total"] = total
    attach_sources(pdf_bytes, questionnaire)  # page + rects per option, for pdf highlighting
    return questionnaire


# numeric criteria never touch the llm — parse the gpa band from each verbatim
# label and pick the band the applicant's value falls in.
def compute_numeric(criterion: dict, value: float):
    for option in criterion["options"]:
        label = option["label"]
        nums = [float(x) for x in re.findall(r"\d+\.?\d*", label)]
        if ">" in label and nums and value > nums[0]:
            return option["score"]
        if "<" in label and nums and value < nums[0]:
            return option["score"]
        if len(nums) >= 2 and min(nums) <= value <= max(nums):
            return option["score"]
    return None
