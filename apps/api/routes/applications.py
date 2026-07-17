from boto3.dynamodb.conditions import Key
from fastapi import APIRouter, HTTPException

from db import applications_table

router = APIRouter(prefix="/applications", tags=["applications"])

APPLICATION_FIELDS = [
    "academic_level",
    "academic_program",
    "application_key",
    "llm_weighted_score",
    "qa_pairs",
    "scholarship_scope",
    "status",
    "year",
]


def _query_application(application_key: str) -> dict:
    """Query applications table by application_key (partition key)."""
    resp = applications_table().query(
        KeyConditionExpression=Key("application_key").eq(application_key)
    )
    items = resp.get("Items", [])
    if not items:
        raise HTTPException(status_code=404, detail="No application found for this application_key")
    return items[0]


@router.get("/{application_key}")
def get_application(application_key: str):
    """Return all application attributes for the given application_key."""
    item = _query_application(application_key)
    return {field: item.get(field) for field in APPLICATION_FIELDS}


@router.get("/{application_key}/academic-level")
def get_academic_level(application_key: str):
    """Return academic_level for the given application_key."""
    item = _query_application(application_key)
    return {"academic_level": item.get("academic_level")}


@router.get("/{application_key}/academic-program")
def get_academic_program(application_key: str):
    """Return academic_program for the given application_key."""
    item = _query_application(application_key)
    return {"academic_program": item.get("academic_program")}


@router.get("/{application_key}/llm-weighted-score")
def get_llm_weighted_score(application_key: str):
    """Return llm_weighted_score for the given application_key."""
    item = _query_application(application_key)
    return {"llm_weighted_score": item.get("llm_weighted_score")}


@router.get("/{application_key}/qa-pairs")
def get_qa_pairs(application_key: str):
    """Return qa_pairs for the given application_key."""
    item = _query_application(application_key)
    return {"qa_pairs": item.get("qa_pairs")}


@router.get("/{application_key}/scholarship-scope")
def get_scholarship_scope(application_key: str):
    """Return scholarship_scope for the given application_key."""
    item = _query_application(application_key)
    return {"scholarship_scope": item.get("scholarship_scope")}


@router.get("/{application_key}/status")
def get_status(application_key: str):
    """Return status for the given application_key."""
    item = _query_application(application_key)
    return {"status": item.get("status")}


@router.get("/{application_key}/year")
def get_year(application_key: str):
    """Return year for the given application_key."""
    item = _query_application(application_key)
    return {"year": item.get("year")}
