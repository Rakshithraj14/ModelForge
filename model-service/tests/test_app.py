"""Runnable smoke check for the /predict path: requires a trained model
artifact (run `uv run train.py` first). No pytest fixtures — plain asserts.

Usage: uv run tests/test_app.py
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient

from app import app

SAMPLE_TRANSACTION = {
    "type": "TRANSFER",
    "amount": 181.0,
    "oldbalanceOrg": 181.0,
    "newbalanceOrig": 0.0,
    "oldbalanceDest": 0.0,
    "newbalanceDest": 0.0,
}


def main() -> None:
    with TestClient(app) as client:
        root = client.get("/")
        assert root.status_code == 200
        assert "endpoints" in root.json()

        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["status"] == "healthy"

        metadata = client.get("/metadata")
        assert metadata.status_code == 200
        assert "features" in metadata.json()

        prediction = client.post("/predict", json=SAMPLE_TRANSACTION)
        assert prediction.status_code == 200, prediction.text
        body = prediction.json()
        assert body["prediction"] in (0, 1)
        assert 0.0 <= body["probability"] <= 1.0

        bad_type = client.post("/predict", json={**SAMPLE_TRANSACTION, "type": "NOT_A_TYPE"})
        assert bad_type.status_code == 422

    print("all checks passed")


if __name__ == "__main__":
    main()
