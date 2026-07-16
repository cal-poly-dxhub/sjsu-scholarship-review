import time
import uuid
from decimal import Decimal

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile
from fastapi.middleware.cors import CORSMiddleware

# pull in .env before anything reads aws creds or table names
load_dotenv()

from db import rubrics_table
from routes.scores import router as scores_router
from rubric_generator import generate_from_pdf

app = FastAPI(title="sjsu-api")

# vite dev server runs on another port, allow it
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(scores_router)


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
