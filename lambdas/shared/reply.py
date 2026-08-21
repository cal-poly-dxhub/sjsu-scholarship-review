"""Checking a model reply, and working out the total from it.

A reply is accepted only if it carries every criterion the rubric names, with ids that
match and every score a whole or half point inside its own maximum. Anything else is a
failure: there is no partial parse, no salvage, and no repair step. A repaired reply is a
score the model did not give.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any


class ReplyError(Exception):
    """A reply that cannot become a score. The raw reply is kept by the caller."""


@dataclass(frozen=True)
class CriterionScore:
    criterion_id: str
    score: float
    max: int
    reasoning: str
    evidence: str


@dataclass(frozen=True)
class CheckedReply:
    scores: list[CriterionScore]
    reasoning_summary: str


# What Bedrock says when a reply ran into the output token limit.
CUT_OFF = "max_tokens"

FENCE = "```"

# How much of an unreadable reply the error carries. Without it, a whole cohort fails with a
# character position and nothing to look at.
SHOWN = 80


def unfenced(raw: str) -> str:
    """The reply with a markdown code fence taken off, if it came in one.

    Asking for no fence does not stop the model using one, and refusing a fenced reply fails
    every application in a cohort. Taking the envelope off is not repairing a reply: what is
    inside it is parsed untouched, and a reply that is wrong inside the fence still fails.
    """
    text = raw.strip()
    if not text.startswith(FENCE):
        return text

    after_fence = text[len(FENCE) :]
    # The rest of the opening line is a language tag — ```json — and not part of the object.
    line_end = after_fence.find("\n")
    if line_end == -1:
        return text

    body = after_fence[line_end + 1 :]
    closing = body.rfind(FENCE)
    return (body[:closing] if closing != -1 else body).strip()


def check_reply(
    raw: str, criteria: list[dict[str, Any]], *, stop_reason: str = ""
) -> CheckedReply:
    """Read a reply and check it against the rubric's criteria. Raises ReplyError.

    `stop_reason` is the model's own reason for stopping. A reply that ran into the output token
    limit is a different problem from a malformed one — the thing to change is the limit — and the
    model saying so is the only way to tell them apart. Guessing from the text calls a truncated
    reply well-formed whenever it happens to stop on a closing brace.
    """
    if stop_reason == CUT_OFF:
        raise ReplyError(
            f"the reply was cut off at the output token limit after {len(raw)} characters — raise"
            " the limit rather than reading this as a bad reply"
        )
    try:
        parsed = json.loads(unfenced(raw))
    except json.JSONDecodeError as error:
        raise ReplyError(
            f"the reply is not JSON: {error.msg} at position {error.pos}."
            f" It starts: {unfenced(raw)[:SHOWN]!r}"
        ) from error
    if not isinstance(parsed, dict):
        raise ReplyError("the reply is not a JSON object")

    entries = parsed.get("criterion_scores")
    if not isinstance(entries, list):
        raise ReplyError("the reply has no 'criterion_scores' list")

    by_max = {criterion["id"]: int(criterion["max"]) for criterion in criteria}
    seen: dict[str, CriterionScore] = {}

    for entry in entries:
        if not isinstance(entry, dict):
            raise ReplyError("an entry in 'criterion_scores' is not an object")

        criterion_id = entry.get("criterion_id")
        if criterion_id not in by_max:
            raise ReplyError(f"'{criterion_id}' is not a criterion this rubric names")
        if criterion_id in seen:
            raise ReplyError(f"'{criterion_id}' is scored twice")

        maximum = by_max[criterion_id]
        seen[criterion_id] = CriterionScore(
            criterion_id=criterion_id,
            score=_checked_score(entry.get("score"), criterion_id, maximum),
            max=maximum,
            reasoning=_text(entry.get("reasoning")),
            evidence=_text(entry.get("evidence")),
        )

    missing = [criterion["id"] for criterion in criteria if criterion["id"] not in seen]
    if missing:
        raise ReplyError(f"the reply is missing {', '.join(missing)}")

    summary = parsed.get("reasoning_summary")
    if not isinstance(summary, str) or not summary.strip():
        raise ReplyError("the reply has no 'reasoning_summary'")

    return CheckedReply(
        scores=[seen[criterion["id"]] for criterion in criteria],
        reasoning_summary=summary.strip(),
    )


def weighted_total(scores: list[CriterionScore], criteria: list[dict[str, Any]]) -> float:
    """Each criterion's share of its own maximum, times its weight. Out of 100."""
    weights = {criterion["id"]: float(criterion["weight"]) for criterion in criteria}
    total = sum((score.score / score.max) * weights[score.criterion_id] for score in scores)
    return round(total, 2)


def _checked_score(value: Any, criterion_id: str, maximum: int) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ReplyError(f"the score for {criterion_id} is not a number")

    score = float(value)
    if score < 0 or score > maximum:
        raise ReplyError(f"the score for {criterion_id} is {_plain(score)}, outside 0-{maximum}")
    # Half points are the step the system allows. Rounding a finer value here would be the
    # check inventing a score, and 3.7 read as 3.5 moves a total by up to 5 out of 100.
    if score * 2 != int(score * 2):
        raise ReplyError(f"the score for {criterion_id} is {_plain(score)}, finer than a half point")
    return score


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _plain(value: float) -> str:
    return str(int(value)) if value == int(value) else str(value)
