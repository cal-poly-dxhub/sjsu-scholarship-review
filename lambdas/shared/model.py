"""The model call, and which failures are worth another go.

Retries for a throttle or a five-hundred are left to botocore, which already backs off. What
this module adds is the line between a failure that means "try again later" and one that means
"this item cannot be scored" — a throttle written down as `score_failed` would be a permanent
verdict on a temporary problem.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

# Anything not in this set is the item's own problem and is not retried.
TRANSIENT = {
    "ThrottlingException",
    "ServiceUnavailableException",
    "InternalServerException",
    "ModelTimeoutException",
    "ModelNotReadyException",
}

_client = None


class Transient(Exception):
    """The model could not answer now. The item stays claimable."""


@dataclass(frozen=True)
class Answer:
    text: str
    input_tokens: int
    output_tokens: int
    # Why the model stopped, in its own words: `end_turn`, `max_tokens`, `content_filtered`, and
    # so on. It is the only reliable way to tell a reply that ran out of tokens from a bad one.
    stop_reason: str = ""


def client():
    """One client per container, with botocore's adaptive backoff doing the waiting."""
    global _client
    if _client is None:
        _client = boto3.client(
            "bedrock-runtime",
            config=Config(retries={"max_attempts": 4, "mode": "adaptive"}),
        )
    return _client


def converse(
    *, model_id: str, system: list[dict[str, str]], user_text: str, max_tokens: int = 2000
) -> Answer:
    """One application, one call. Temperature 0 — the same essay should score the same twice."""
    try:
        response = client().converse(
            modelId=model_id,
            system=system,
            messages=[{"role": "user", "content": [{"text": user_text}]}],
            inferenceConfig={"temperature": 0, "maxTokens": max_tokens},
        )
    except ClientError as error:
        code = error.response["Error"]["Code"]
        if code in TRANSIENT:
            raise Transient(f"{code}: {error.response['Error'].get('Message', '')}") from error
        raise

    return Answer(
        text=text_of(response),
        input_tokens=int(response["usage"]["inputTokens"]),
        output_tokens=int(response["usage"]["outputTokens"]),
        stop_reason=str(response.get("stopReason", "")),
    )


def text_of(response: dict[str, Any]) -> str:
    """The reply's text blocks joined. A reply with no text is an empty string, not an error."""
    blocks = response.get("output", {}).get("message", {}).get("content", [])
    return "".join(block.get("text", "") for block in blocks)
