"""Checking a model reply, and working out the total from it.

A reply is accepted only if it carries every criterion the rubric names, with ids that
match and every score a whole or half point inside its own maximum. Anything else is a
failure: there is no partial parse, no salvage, and no repair step. A repaired reply is a
score the model did not give.

Taking a markdown fence off the whole reply is the one exception, and it is not a repair: the
object inside is read exactly as the model wrote it.
"""

from __future__ import annotations

import json
import re
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

# The whole reply in a fence, and nothing outside it. Claude wraps its answer this way whatever
# the prompt says not to, and an unwrapped fence failed every application in a run. Matching the
# entire reply rather than searching it keeps this to the wrapper: a reply with prose around the
# object is a different problem and still a failure.
FENCED = re.compile(r"\s*```(?:json)?\s*(\{.*\})\s*```\s*", re.DOTALL)


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
        raise ReplyError(f"the reply is not JSON: {error.msg} at position {error.pos}") from error
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


def unfenced(raw: str) -> str:
    """The reply with its markdown fence taken off, or the reply as it came if it had none."""
    found = FENCED.fullmatch(raw)
    return found.group(1) if found else raw


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
