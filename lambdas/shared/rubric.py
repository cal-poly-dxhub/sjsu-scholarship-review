"""Reading a rubric file into criteria, and checking a set of weights.

The parse refuses anything it does not recognise and names the line that stopped it.
A guessed maximum would move every score under it without failing anything, so there
is no lenient branch here and nothing is corrected on the way in.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

CATEGORY_LINE = re.compile(r"^Category:\s*(?P<rest>.+)$")
CATEGORY_RANGE = re.compile(r"\((?P<low>\d+)\s*-\s*(?P<high>\d+)\)")
LEVEL_LINE = re.compile(r"^-\s*(?P<value>-?\d+(?:\.\d+)?)\s*=\s*(?P<text>.*)$")
BANNER_LINE = re.compile(r"^=+$")
NON_WORD = re.compile(r"[^a-z0-9]+")

WEIGHT_TOTAL = 100


class RubricError(Exception):
    """A rubric file, or a set of weights, that is refused. Carries the line that caused it."""

    def __init__(self, message: str, line_number: int | None = None) -> None:
        self.message = message
        self.line_number = line_number
        super().__init__(f"line {line_number}: {message}" if line_number else message)


@dataclass(frozen=True)
class Level:
    value: float
    description: str


@dataclass(frozen=True)
class Criterion:
    id: str
    name: str
    max: int
    levels: list[Level]
    guidance: str


@dataclass(frozen=True)
class ParsedRubric:
    criteria: list[Criterion]
    preamble: str


def slug(name: str) -> str:
    """The criterion id: the name, lowercased, with runs of anything else as one underscore."""
    return NON_WORD.sub("_", name.strip().lower()).strip("_")


def parse_rubric(text: str) -> ParsedRubric:
    """Read a rubric file. Raises RubricError naming the line that stopped it."""
    preamble: list[str] = []
    blocks: list[_Block] = []
    current: _Block | None = None
    in_banner = False

    for number, raw in enumerate(text.splitlines(), start=1):
        line = raw.rstrip()

        # A banner block is the rubric talking to the grader, wherever it sits in the file,
        # so it belongs to the preamble even when it comes after the last criterion.
        if BANNER_LINE.match(line.strip()) and line.strip():
            in_banner = not in_banner
            preamble.append(line)
            continue
        if in_banner:
            preamble.append(line)
            continue

        header = CATEGORY_LINE.match(line)
        if header:
            current = _open_block(header.group("rest"), number)
            blocks.append(current)
            continue

        if current is None:
            preamble.append(line)
            continue

        level = LEVEL_LINE.match(line.strip())
        if level:
            current.add_level(level.group("value"), level.group("text"), number)
            continue

        current.guidance.append(line)

    if in_banner:
        raise RubricError("a banner block was opened with === and never closed")
    if not blocks:
        raise RubricError("no criterion found — a criterion opens with a 'Category:' line")

    criteria = [block.finish() for block in blocks]
    _refuse_repeated_ids(criteria, blocks)
    return ParsedRubric(criteria=criteria, preamble="\n".join(preamble).strip())


def validate_weights(criteria: list[Criterion], weights: dict[str, float]) -> dict[str, float]:
    """Check one weight per criterion, each above zero, summing to 100. Refuses, never corrects."""
    missing = [c.id for c in criteria if c.id not in weights]
    if missing:
        raise RubricError(f"no weight given for {', '.join(missing)}")

    unknown = sorted(set(weights) - {c.id for c in criteria})
    if unknown:
        raise RubricError(f"weight given for a criterion the rubric does not have: {', '.join(unknown)}")

    for criterion in criteria:
        weight = weights[criterion.id]
        if weight <= 0:
            raise RubricError(f"weight for {criterion.id} is {weight} — a weight must be above zero")

    total = sum(weights[c.id] for c in criteria)
    if total != WEIGHT_TOTAL:
        raise RubricError(f"weights sum to {total}, not {WEIGHT_TOTAL}")

    return {c.id: float(weights[c.id]) for c in criteria}


@dataclass
class _Block:
    name: str
    maximum: int
    header_line: int
    levels: list[Level]
    guidance: list[str]

    def add_level(self, value_text: str, description: str, line_number: int) -> None:
        value = float(value_text)
        if value * 2 != int(value * 2):
            raise RubricError(f"level {value_text} is finer than a half point", line_number)
        if value < 0:
            raise RubricError(f"level {value_text} is below zero", line_number)
        if value > self.maximum:
            raise RubricError(
                f"level {value_text} is above the maximum of {self.maximum} for {self.name}",
                line_number,
            )
        if any(level.value == value for level in self.levels):
            raise RubricError(f"level {value_text} is given twice for {self.name}", line_number)
        self.levels.append(Level(value=value, description=description.strip()))

    def finish(self) -> Criterion:
        values = {level.value for level in self.levels}
        if not values:
            raise RubricError(f"{self.name} has no levels", self.header_line)
        if 0 not in values:
            raise RubricError(f"{self.name} has no level at 0", self.header_line)
        if self.maximum not in values:
            raise RubricError(
                f"{self.name} has no level at its maximum of {self.maximum}", self.header_line
            )
        return Criterion(
            id=slug(self.name),
            name=self.name,
            max=self.maximum,
            levels=sorted(self.levels, key=lambda level: level.value, reverse=True),
            guidance="\n".join(self.guidance).strip(),
        )


def _open_block(rest: str, line_number: int) -> _Block:
    """The first (low-high) on a Category line is the range; the rest of the line is dropped."""
    found = CATEGORY_RANGE.search(rest)
    if not found:
        raise RubricError("a 'Category:' line with no (low-high) score range", line_number)

    low, high = int(found.group("low")), int(found.group("high"))
    if low != 0:
        raise RubricError(f"score range starts at {low}, not 0", line_number)
    if high <= 0:
        raise RubricError(f"score range ends at {high} — a maximum must be above zero", line_number)

    name = rest[: found.start()].strip().rstrip("—-–").strip()
    if not name:
        raise RubricError("a 'Category:' line with no name", line_number)

    return _Block(name=name, maximum=high, header_line=line_number, levels=[], guidance=[])


def _refuse_repeated_ids(criteria: list[Criterion], blocks: list[_Block]) -> None:
    seen: dict[str, str] = {}
    for criterion, block in zip(criteria, blocks):
        first = seen.get(criterion.id)
        if first is not None:
            raise RubricError(
                f"'{criterion.name}' and '{first}' both give the id {criterion.id}",
                block.header_line,
            )
        seen[criterion.id] = criterion.name
