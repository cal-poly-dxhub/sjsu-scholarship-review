"""Reading an uploaded spreadsheet as rows, whichever of the two formats it came in.

Both the application export and the reviewer-score export are read through here. Only the
decoding differs between a workbook and a CSV; the header check and everything after it are
shared, so the two formats cannot drift apart — and neither can the two kinds of file.
"""

from __future__ import annotations

import csv
import io
from typing import Any, Iterable, Iterator

import boto3
import openpyxl


class RowsError(Exception):
    """The file cannot be read at all. Nothing was written."""


def read_rows(bucket: str, key: str, *, columns: Iterable[str], what: str) -> Iterator[dict[str, Any]]:
    """Rows as dicts keyed by the header line, from a workbook or a CSV.

    `columns` are the names the file has to name at least one of for its first row to count as a
    header. `what` names the kind of file in the message when it does not.
    """
    body = boto3.client("s3").get_object(Bucket=bucket, Key=key)["Body"].read()
    raw = csv_rows(body) if key.endswith(".csv") else workbook_rows(body)

    try:
        header = next(raw)
    except StopIteration:
        raise RowsError(f"'{key}' is empty — no header row.") from None

    names = [str(cell).strip() if cell is not None else "" for cell in header]
    if not any(column in names for column in columns):
        # Without this, a file whose first row is data reads as a file full of unusable rows and
        # the run reports a clean nothing.
        raise RowsError(
            f"'{key}' names none of the {what}'s columns in its first row, so it has no header"
            " row to read the rest by."
        )

    for row in raw:
        yield {names[i]: row[i] for i in range(min(len(names), len(row)))}


def workbook_rows(body: bytes) -> Iterator[tuple[Any, ...]]:
    """The first sheet's rows. Read-only so a large workbook stays cheap."""
    sheet = openpyxl.load_workbook(io.BytesIO(body), read_only=True, data_only=True).worksheets[0]
    return sheet.iter_rows(values_only=True)


def csv_rows(body: bytes) -> Iterator[list[str]]:
    """The CSV's rows, read by the `csv` module because most essays hold line breaks."""
    # newline="" so the reader sees the line endings itself — nothing else gets a chance to
    # translate a break inside a quoted essay into the end of a record.
    return iter(csv.reader(io.StringIO(decode(body), newline="")))


def decode(body: bytes) -> str:
    """CSV text, UTF-8 if it is UTF-8 and Windows-1252 if it is not."""
    try:
        return body.decode("utf-8-sig")
    except UnicodeDecodeError:
        # Scholarship Manager writes curly apostrophes as cp1252, which strict UTF-8 refuses —
        # one byte would fail the whole intake. cp1252 is second, not first, because it maps
        # every byte and so can never raise: a real UTF-8 export read this way would come
        # through as mojibake with nothing to say it had.
        return body.decode("cp1252")


def cell(value: Any) -> str | None:
    """Cell text with the spreadsheet's artifacts taken off. Blank reads as nothing."""
    if value is None:
        return None
    if isinstance(value, float) and value == int(value):
        return str(int(value))
    text = str(value).strip()
    return text or None


def number_or_none(text: str | None) -> float | None:
    if text is None:
        return None
    try:
        return float(text)
    except ValueError:
        return None
