"""Building the prompt. One implementation, used by both workers.

The prompt is two system parts and one user part. The first system part is the rubric file
the version was published from, sent exactly as it was stored — the file the scholarship
office wrote is the file the model reads. The second is the output contract, generated from
the rubric item's `criteria` so the ids and ranges the reply check enforces are the ones
the model is given. The user part is the applicant's own text and nothing else.

No cache checkpoint is placed and no cache saving is claimed: the system parts are about
1,000 tokens against a 4,096-token minimum.
"""

from __future__ import annotations

from typing import Any

CONTRACT_HEAD = """Score the application against the rubric above.

The criteria, and the id to use for each:"""

CONTRACT_TAIL = """
Return one JSON object and nothing else. No prose, no markdown fence.

{
  "criterion_scores": [
    {
      "criterion_id": "one of the ids listed above",
      "score": 0,
      "reasoning": "why this score, in one or two sentences",
      "evidence": "the applicant's own words you scored from"
    }
  ],
  "reasoning_summary": "one or two sentences about the application as a whole"
}

Rules:
- One entry for every criterion listed above, using its id. No extra entries.
- A score is any number from 0 up to that criterion's maximum — a whole number or a
  fraction, as fine as the rubric calls for.
- Do not give a total. The total is worked out from these scores.
- Score only from the application text given. Do not invent facts.
"""


class MissingRubricFile(Exception):
    """A published version with no file to send. The run stops rather than assembling one."""


def output_contract(criteria: list[dict[str, Any]]) -> str:
    """What the reply has to look like, and the ids and ranges it is checked against.

    The ids are listed here because they are ours: they key the stored scores, the weights,
    and the screens, and they have never appeared in a rubric file.
    """
    lines = [
        f"- {criterion['id']}: {criterion['name']}, score 0 to {int(criterion['max'])}"
        for criterion in criteria
    ]
    return f"{CONTRACT_HEAD}\n" + "\n".join(lines) + "\n" + CONTRACT_TAIL


def system_blocks(rubric_item: dict[str, Any]) -> list[dict[str, str]]:
    """The two system parts: the published file untouched, then the output contract."""
    source_text = rubric_item.get("source_text")
    if not isinstance(source_text, str) or not source_text.strip():
        scholarship = str(rubric_item.get("pk", "")).removeprefix("RUBRIC#")
        version = str(rubric_item.get("sk", "")).removeprefix("V#")
        raise MissingRubricFile(
            f"rubric version {version} of {scholarship} has no rubric file stored, so there is"
            " nothing to send to the model. Publish that version again from its file."
        )
    return [{"text": source_text}, {"text": output_contract(rubric_item["criteria"])}]


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
