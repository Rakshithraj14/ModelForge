import json
import os
import time
import urllib.request
from contextlib import asynccontextmanager

import joblib
import pandas as pd
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from pydantic import BaseModel

from features import FEATURE_COLUMNS, TRANSACTION_TYPES

load_dotenv()

ARTIFACT_DIR = os.path.join(os.path.dirname(__file__), "artifacts")
START_TIME = time.time()

state: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    state["pipeline"] = joblib.load(os.path.join(ARTIFACT_DIR, "model.joblib"))
    with open(os.path.join(ARTIFACT_DIR, "metadata.json")) as f:
        state["metadata"] = json.load(f)
    yield


app = FastAPI(lifespan=lifespan)


class PredictRequest(BaseModel):
    type: str
    amount: float
    oldbalanceOrg: float
    newbalanceOrig: float
    oldbalanceDest: float
    newbalanceDest: float


def send_telemetry(model_id: str, features: dict, prediction: int, probability: float, latency_ms: float) -> None:
    url = os.environ.get("MODEL_DOCTOR_TELEMETRY_URL")
    key = os.environ.get("TELEMETRY_API_KEY")
    if not url or not key:
        return
    payload = json.dumps(
        {
            "model_id": model_id,
            "features": features,
            "prediction": prediction,
            "probability": probability,
            "latency_ms": latency_ms,
        }
    ).encode()
    request = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "User-Agent": "modelforge-model-service/1.0",
        },
    )
    try:
        urllib.request.urlopen(request, timeout=5)
    except Exception as exc:  # telemetry must never break a prediction response
        print(f"telemetry POST failed: {exc}")


def require_api_key(authorization: str | None) -> None:
    expected = os.environ.get("APP_API_KEY")
    if expected and authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="invalid or missing API key")


@app.get("/")
def root():
    return {
        "service": "model-doctor-model-service",
        "endpoints": {
            "GET /health": "service + model status",
            "GET /metadata": "model feature schema and training metrics",
            "POST /predict": "fraud prediction for a transaction",
        },
    }


@app.post("/predict")
def predict(request: PredictRequest, background_tasks: BackgroundTasks, authorization: str | None = Header(default=None)):
    require_api_key(authorization)
    if request.type not in TRANSACTION_TYPES:
        raise HTTPException(status_code=422, detail=f"type must be one of {TRANSACTION_TYPES}")

    start = time.perf_counter()
    features = request.model_dump()
    row = pd.DataFrame([features])[FEATURE_COLUMNS]
    probability = float(state["pipeline"].predict_proba(row)[0, 1])
    prediction = int(probability >= 0.5)
    latency_ms = (time.perf_counter() - start) * 1000

    metadata = state["metadata"]
    background_tasks.add_task(
        send_telemetry, metadata["model"], features, prediction, probability, latency_ms
    )

    return {"prediction": prediction, "probability": probability, "model_version": metadata["version"]}


@app.get("/health")
def health():
    metadata = state["metadata"]
    return {
        "status": "healthy",
        "model": metadata["model"],
        "version": metadata["version"],
        "uptime": time.time() - START_TIME,
    }


@app.get("/metadata")
def metadata():
    return state["metadata"]
