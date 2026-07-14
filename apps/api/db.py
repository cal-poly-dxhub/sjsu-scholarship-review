import os

import boto3

# table names are env-driven so local dev, shadow runs, and other campuses can
# point at their own tables without code changes
APPLICATIONS_TABLE = os.environ.get("APPLICATIONS_TABLE", "sjsu-applications")
SCORES_TABLE = os.environ.get("SCORES_TABLE", "sjsu-scores")

_dynamo = None


def dynamo():
    global _dynamo
    if _dynamo is None:
        _dynamo = boto3.resource(
            "dynamodb", region_name=os.environ.get("AWS_REGION", "us-west-2")
        )
    return _dynamo


def applications_table():
    return dynamo().Table(APPLICATIONS_TABLE)


def scores_table():
    return dynamo().Table(SCORES_TABLE)
