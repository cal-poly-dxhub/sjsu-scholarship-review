import time
import uuid
from decimal import Decimal

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile
from fastapi.middleware.cors import CORSMiddleware

# pull in .env before anything reads aws creds or table names
load_dotenv()

from db import rubrics_table, applications_table, scores_table
from rubric_generator import generate_from_pdf

app = FastAPI(title="sjsu-api")

# vite dev server runs on another port, allow it
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True}


# drop a rubric pdf, get back a draft questionnaire (verbatim options + type per
# criterion). nothing is saved here — the human reviews before approving.
@app.post("/rubrics/generate")
async def rubrics_generate(file: UploadFile):
    pdf_bytes = await file.read()
    return generate_from_pdf(pdf_bytes)


# human approved the draft (possibly edited) — persist it so the judge can use it
# dynamodb rejects python floats (pdf coords, page dims) — floats become Decimal, rest untouched
def _decimalize(o):
    if isinstance(o, bool):
        return o
    if isinstance(o, float):
        return Decimal(str(o))
    if isinstance(o, dict):
        return {k: _decimalize(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_decimalize(v) for v in o]
    return o


@app.post("/rubrics")
def rubrics_save(questionnaire: dict):
    rubric_id = questionnaire.get("rubric_id") or str(uuid.uuid4())
    item = {**questionnaire, "rubric_id": rubric_id, "approved_at": int(time.time())}
    rubrics_table().put_item(Item=_decimalize(item))
    return {"rubric_id": rubric_id}


@app.get("/rubrics")
def rubrics_list():
    return {"rubrics": rubrics_table().scan().get("Items", [])}


# TODO: applications list, scores by application, comparison (ai vs human)


# --- Scholarships & Applications ---


@app.get("/scholarships")
def scholarships_list():
    """List distinct scholarship availability_ids."""
    table = applications_table()
    items = []
    kwargs = {"ProjectionExpression": "availability_id"}
    while True:
        resp = table.scan(**kwargs)
        items.extend(resp.get("Items", []))
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]

    unique = sorted(set(i.get("availability_id", "") for i in items if i.get("availability_id")))
    return {"scholarships": unique}


@app.get("/scholarships/{availability_id}/applications")
def scholarship_applications(availability_id: str):
    """Get ranked applications for a scholarship, sorted by final score (avg of human + AI)."""
    from boto3.dynamodb.conditions import Attr

    app_table = applications_table()
    sc_table = scores_table()

    # Get all applications for this scholarship
    apps = []
    kwargs = {"FilterExpression": Attr("availability_id").eq(availability_id)}
    while True:
        resp = app_table.scan(**kwargs)
        apps.extend(resp.get("Items", []))
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]

    # Get all scores
    scores = []
    kwargs2 = {}
    while True:
        resp = sc_table.scan(**kwargs2)
        scores.extend(resp.get("Items", []))
        if "LastEvaluatedKey" not in resp:
            break
        kwargs2["ExclusiveStartKey"] = resp["LastEvaluatedKey"]

    scores_lookup = {s["application_key"]: s for s in scores}

    results = []
    for a in apps:
        app_key = a["application_key"]
        score = scores_lookup.get(app_key, {})

        human_total = float(score.get("human_weighted_total", 0) or 0)
        llm_total = float(score.get("llm_weighted_score", 0) or 0)

        # Only show apps that have both human and LLM scores
        if not human_total or not llm_total:
            continue

        # Exclude apps flagged for review — those belong in the Review tab
        if a.get("needs_human_review") is True:
            continue

        review_score = score.get("review_weighted_score")

        # Final score: reviewer override if exists, else avg of human + AI
        if review_score is not None:
            final = float(review_score)
        else:
            final = (human_total + llm_total) / 2

        variance_pct = float(score.get("score_variance", 0) or 0)

        results.append({
            "application_key": app_key,
            "gpa": a.get("gpa"),
            "major": a.get("major"),
            "human_weighted_total": human_total,
            "llm_weighted_score": llm_total,
            "final_weighted_score": round(final, 2),
            "variance_pct": variance_pct,
            "needs_human_review": a.get("needs_human_review", False),
        })

    results.sort(key=lambda x: x["final_weighted_score"], reverse=True)
    return {"applications": results}


@app.get("/applications/{application_key}")
def application_detail(application_key: str):
    """Full application detail: metadata, essays, and all scores."""
    app_table = applications_table()
    sc_table = scores_table()

    app_resp = app_table.get_item(Key={"application_key": application_key})
    app = app_resp.get("Item")
    if not app:
        return {"error": "Application not found"}, 404

    score_resp = sc_table.get_item(Key={"application_key": application_key})
    score = score_resp.get("Item", {})

    human_total = float(score.get("human_weighted_total", 0) or 0)
    llm_total = float(score.get("llm_weighted_score", 0) or 0)

    variance_pct = float(score.get("score_variance", 0) or 0)

    return {
        "application_key": application_key,
        "gpa": app.get("gpa"),
        "major": app.get("major"),
        "academic_level": app.get("academic_level"),
        "academic_program": app.get("academic_program"),
        "year": app.get("year"),
        "availability_id": app.get("availability_id"),
        "qa_pairs": app.get("qa_pairs", []),
        "human_criterion_scores": score.get("human_criterion_scores", []),
        "human_weighted_total": human_total,
        "criterion_scores": score.get("criterion_scores", []),
        "llm_weighted_score": llm_total,
        "variance_pct": variance_pct,
        "needs_human_review": app.get("needs_human_review", False),
        "review_criterion_scores": score.get("review_criterion_scores"),
        "review_weighted_score": score.get("review_weighted_score"),
    }


# --- Review Queue ---


@app.get("/reviews")
def reviews_list():
    """List all applications flagged for human review."""
    from boto3.dynamodb.conditions import Attr

    sc_table = scores_table()
    app_table = applications_table()

    # Get flagged applications (flag lives on applications table)
    flagged_apps = []
    kwargs = {"FilterExpression": Attr("needs_human_review").eq(True)}
    while True:
        resp = app_table.scan(**kwargs)
        flagged_apps.extend(resp.get("Items", []))
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]

    # Get scores for each flagged app — only include if both scored
    results = []
    for app in flagged_apps:
        app_key = app["application_key"]
        score_resp = sc_table.get_item(Key={"application_key": app_key})
        score = score_resp.get("Item", {})

        human_total = float(score.get("human_weighted_total", 0) or 0)
        llm_total = float(score.get("llm_weighted_score", 0) or 0)

        if not human_total or not llm_total:
            continue

        variance_pct = float(score.get("score_variance", 0) or 0)

        results.append({
            "application_key": app_key,
            "gpa": app.get("gpa"),
            "major": app.get("major"),
            "availability_id": app.get("availability_id"),
            "human_weighted_total": human_total,
            "llm_weighted_score": llm_total,
            "variance_pct": variance_pct,
        })

    results.sort(key=lambda x: x["variance_pct"], reverse=True)
    return {"reviews": results}


REVIEW_WEIGHTS = {
    "Extracurricular Activities":   {"max": 1, "weight": 10},
    "Career Goals Essay":           {"max": 4, "weight": 40},
    "Challenge Essay":              {"max": 4, "weight": 30},
    "Initiative & Self-Motivation": {"max": 3, "weight": 10},
    "Creativity":                   {"max": 3, "weight": 10},
}


@app.post("/reviews/{application_key}/submit")
def submit_review(application_key: str, body: dict):
    """Submit tiebreaker scores. Calculates new weighted score and clears the review flag."""
    sc_table = scores_table()
    app_table = applications_table()

    criterion_scores = body.get("criterion_scores", [])
    if not criterion_scores:
        return {"error": "criterion_scores required"}, 400

    # Calculate weighted score from reviewer's criteria (same formula as LLM)
    total = 0.0
    for cs in criterion_scores:
        w = REVIEW_WEIGHTS.get(cs.get("criterion", ""))
        if w and w["max"] > 0:
            total += (float(cs["score"]) / w["max"]) * w["weight"]
    review_weighted_score = round(total, 2)

    # Update the score record with review scores
    sc_table.update_item(
        Key={"application_key": application_key},
        UpdateExpression="SET review_criterion_scores = :rcs, review_weighted_score = :rws",
        ExpressionAttributeValues={
            ":rcs": _decimalize(criterion_scores),
            ":rws": _decimalize(review_weighted_score),
        },
    )

    # Clear the flag on the applications table
    app_table.update_item(
        Key={"application_key": application_key},
        UpdateExpression="SET needs_human_review = :flag",
        ExpressionAttributeValues={":flag": False},
    )

    return {
        "application_key": application_key,
        "review_weighted_score": review_weighted_score,
        "needs_human_review": False,
    }


# --- Dashboard Stats ---


@app.get("/dashboard/stats")
def dashboard_stats():
    """Aggregate stats for the overview dashboard."""
    sc_table = scores_table()
    app_table = applications_table()

    items = []
    kwargs = {}
    while True:
        resp = sc_table.scan(**kwargs)
        items.extend(resp.get("Items", []))
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]

    # Count flagged apps from the applications table
    from boto3.dynamodb.conditions import Attr
    flagged_count = 0
    kwargs2 = {"FilterExpression": Attr("needs_human_review").eq(True), "Select": "COUNT"}
    while True:
        resp = app_table.scan(**kwargs2)
        flagged_count += resp["Count"]
        if "LastEvaluatedKey" not in resp:
            break
        kwargs2["ExclusiveStartKey"] = resp["LastEvaluatedKey"]

    total = len(items)
    both_scored = [i for i in items if i.get("criterion_scores") and i.get("human_criterion_scores")]

    variances = []
    for i in both_scored:
        sv = i.get("score_variance")
        if sv is not None:
            variances.append(float(sv))

    avg_variance = round(sum(variances) / len(variances), 1) if variances else 0
    within_10 = len([v for v in variances if v <= 10])
    agreement_rate = round(within_10 / len(variances) * 100, 1) if variances else 0

    return {
        "total_applications": len(both_scored),
        "both_scored": len(both_scored),
        "flagged_for_review": flagged_count,
        "avg_variance_pct": avg_variance,
        "agreement_rate_pct": agreement_rate,
        "variance_distribution": {
            "0_5": len([v for v in variances if v <= 5]),
            "5_10": len([v for v in variances if 5 < v <= 10]),
            "10_20": len([v for v in variances if 10 < v <= 20]),
            "20_plus": len([v for v in variances if v > 20]),
        },
    }


# --- Analytics (pre-computed from S3) ---

import csv
import io

ANALYTICS_BUCKET = "sjsu-scholarship-data-analysis-export"

def _read_csv_from_s3(key: str) -> list[dict]:
    """Read a CSV file from S3 and return as list of dicts."""
    import boto3 as _boto3
    s3 = _boto3.client("s3", region_name="us-west-2")
    resp = s3.get_object(Bucket=ANALYTICS_BUCKET, Key=key)
    content = resp["Body"].read().decode("utf-8")
    reader = csv.DictReader(io.StringIO(content))
    return list(reader)


@app.get("/analytics")
def analytics():
    """Serve pre-computed analytics data for the dashboard."""
    try:
        ai_human_summary = _read_csv_from_s3("Analytics/ai_human_agreement_summary.csv")
        human_summary_raw = _read_csv_from_s3("Analytics/comparison_ready_human_summary.csv")
        reviewer_dist = _read_csv_from_s3("Analytics/reviewer_difference_distribution.csv")
        scholarship_stats = _read_csv_from_s3("Analytics/scholarship_statistics.csv")
        criterion_stats = _read_csv_from_s3("Analytics/criterion_statistics.csv")

        # Parse AI vs Human summary into a dict
        ai_human = {}
        for row in ai_human_summary:
            ai_human[row.get("Comparison_Type", "")] = row.get("ai_vs_human", "")

        # Parse human summary
        human_summary = human_summary_raw[0] if human_summary_raw else {}

        return {
            "ai_human": {
                "total_applications": ai_human.get("Total_Applications", "0"),
                "total_comparisons": ai_human.get("Total_Comparisons", "0"),
                "avg_difference": ai_human.get("Average_Difference", "0"),
                "exact_match_rate": ai_human.get("Exact_Match_Rate", "0"),
                "within_one_point_rate": ai_human.get("Within_One_Point_Rate", "0"),
            },
            "human_vs_human": {
                "total_reviews": human_summary.get("Total_Reviews", "0"),
                "avg_difference": human_summary.get("Average_Difference", "0"),
                "exact_match_rate": human_summary.get("Exact_Match_Rate", "0"),
                "within_one_point_rate": human_summary.get("Within_One_Point_Rate", "0"),
                "moderate_difference_rate": human_summary.get("Moderate_Difference_Rate", "0"),
                "significant_difference_rate": human_summary.get("Significant_Difference_Rate", "0"),
            },
            "reviewer_distribution": [
                {"level": row.get("Agreement_Level", ""), "count": row.get("Count", "0"), "percentage": row.get("Percentage", "0")}
                for row in reviewer_dist
            ],
            "scholarship_stats": [
                {
                    "scholarship": row.get("Scholarship", ""),
                    "avg_difference": row.get("Average_Difference", "0"),
                    "exact_match_rate": row.get("Exact_Match_Rate", "0"),
                    "within_one_point_rate": row.get("Within_One_Point_Rate", "0"),
                    "significant_difference_rate": row.get("Significant_Difference_Rate", "0"),
                }
                for row in scholarship_stats
            ],
            "criterion_stats": [
                {
                    "criterion": row.get("Criterion", ""),
                    "avg_difference": row.get("Average_Difference", "0"),
                    "exact_match_rate": row.get("Exact_Match_Rate", "0"),
                    "within_one_point_rate": row.get("Within_One_Point_Rate", "0"),
                }
                for row in criterion_stats
            ],
        }
    except Exception as e:
        return {"error": f"Failed to load analytics: {str(e)}"}
