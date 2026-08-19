"""Building the prompt. One implementation, used by both workers.

The rubric text the model reads is assembled from the rubric item's `criteria` and
`preamble`, so the text and the ranges the reply check enforces cannot disagree. The file a
version was published from is never read here.

The prompt is a static part — rubric, instructions, schema — followed by the applicant's own
text, with nothing per-item in the static part. No cache checkpoint is placed and no cache
saving is claimed: the static part is about 1,000 tokens against a 4,096-token minimum.
"""

from __future__ import annotations

from typing import Any

SCHEMA_BLOCK = """
Return one JSON object and nothing else. No prose, no markdown fence.

{
  "criterion_scores": [
    {
      "criterion_id": "the id given for the criterion, exactly as written above",
      "score": 0,
      "reasoning": "why this score, in one or two sentences",
      "evidence": "the applicant's own words you scored from"
    }
  ],
  "reasoning_summary": "one or two sentences about the application as a whole"
}

Rules:
- One entry for every criterion above, using its id. No extra entries.
- Score within that criterion's range. Whole or half points only.
- Do not give a total. The total is worked out from these scores.
- Score only from the application text given. Do not invent facts.
"""


def rubric_text(criteria: list[dict[str, Any]], preamble: str) -> str:
    """The rubric as the model reads it: the published preamble, then each criterion."""
    parts: list[str] = []
    if preamble:
        parts.append(preamble)

    for criterion in criteria:
        block = [f"Criterion: {criterion['name']} (id: {criterion['id']}, 0-{criterion['max']})"]
        guidance = criterion.get("guidance")
        if guidance:
            block.append(guidance)
        for level in criterion.get("levels", []):
            block.append(f"- {_plain(level['value'])} = {level['description']}")
        parts.append("\n".join(block))

    return "\n\n".join(parts)


def static_prefix(rubric_item: dict[str, Any]) -> str:
    """The part of the prompt that is identical for every application in a run."""
    return rubric_text(rubric_item["criteria"], rubric_item.get("preamble", "")) + "\n" + SCHEMA_BLOCK


def applicant_text(application: dict[str, Any]) -> str:
    """The application itself. No applicant name exists to leave out — the id is a UUID."""
    lines: list[str] = []
    for field, label in (
        ("academic_level", "Academic level"),
        ("academic_program", "Academic program"),
        ("major", "Major"),
        ("gpa", "GPA"),
    ):
        value = application.get(field)
        if value not in (None, ""):
            lines.append(f"{label}: {value}")

    lines.append("")
    for pair in application.get("qa_pairs", []):
        lines.append(f"Question: {pair.get('question', '')}")
        lines.append(f"Answer: {pair.get('answer', '')}")
        lines.append("")

    return "\n".join(lines).strip()


def _plain(value: Any) -> str:
    """3.0 reads as 3, 3.5 stays 3.5 — the rubric's own way of writing a level."""
    number = float(value)
    return str(int(number)) if number == int(number) else str(number)
