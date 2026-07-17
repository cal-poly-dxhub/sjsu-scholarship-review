from boto3.dynamodb.conditions import Key
from fastapi import APIRouter, HTTPException

from db import scores_table

router = APIRouter(prefix="/scores", tags=["scores"])

SCORE_FIELDS = [
    "criterion_scores",
    "human_criterion_scores",
    "human_weighted_total",
    "llm_weighted_score",
    "scholarship_scope",
    "score_variance",
]


def _query_scores(application_key: str) -> dict:
    """Query scores table by application_key (partition key)."""
    resp = scores_table().query(
        KeyConditionExpression=Key("application_key").eq(application_key)
    )
    items = resp.get("Items", [])
    if not items:
        raise HTTPException(status_code=404, detail="No scores found for this application_key")
    return items[0]


@router.get("/{application_key}")
def get_scores(application_key: str):
    """Return all score attributes for the given application_key."""
    item = _query_scores(application_key)
    return {field: item.get(field) for field in SCORE_FIELDS}


@router.get("/{application_key}/criterion-scores")
def get_criterion_scores(application_key: str):
    """Return criterion_scores for the given application_key."""
    item = _query_scores(application_key)
    return {"criterion_scores": item.get("criterion_scores")}


@router.get("/{application_key}/human-criterion-scores")
def get_human_criterion_scores(application_key: str):
    """Return human_criterion_scores for the given application_key."""
    item = _query_scores(application_key)
    return {"human_criterion_scores": item.get("human_criterion_scores")}


@router.get("/{application_key}/human-weighted-total")
def get_human_weighted_total(application_key: str):
    """Return human_weighted_total for the given application_key."""
    item = _query_scores(application_key)
    return {"human_weighted_total": item.get("human_weighted_total")}


@router.get("/{application_key}/llm-weighted-score")
def get_llm_weighted_score(application_key: str):
    """Return llm_weighted_score for the given application_key."""
    item = _query_scores(application_key)
    return {"llm_weighted_score": item.get("llm_weighted_score")}


@router.get("/{application_key}/scholarship-scope")
def get_scholarship_scope(application_key: str):
    """Return scholarship_scope for the given application_key."""
    item = _query_scores(application_key)
    return {"scholarship_scope": item.get("scholarship_scope")}


@router.get("/{application_key}/score-variance")
def get_score_variance(application_key: str):
    """Return score_variance for the given application_key."""
    item = _query_scores(application_key)
    return {"score_variance": item.get("score_variance")}
