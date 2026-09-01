"""Train the V0 fraud-detection model on PaySim and save it for app.py to serve.

Usage: uv run train.py [--csv data/paysim.csv] [--sample-size 200000] [--version v1]
"""

import argparse
import json
import os

import joblib
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline

from features import CATEGORICAL_FEATURES, FEATURE_COLUMNS, LABEL_COLUMN, NUMERIC_FEATURES, build_preprocessor

ARTIFACT_DIR = os.path.join(os.path.dirname(__file__), "artifacts")


def load_data(csv_path: str, sample_size: int) -> pd.DataFrame:
    df = pd.read_csv(csv_path, usecols=FEATURE_COLUMNS + [LABEL_COLUMN])
    if sample_size and len(df) > sample_size:
        # stratified subsample so the rare fraud class survives the cut
        df, _ = train_test_split(
            df, train_size=sample_size, stratify=df[LABEL_COLUMN], random_state=42
        )
    return df


def compute_baseline(df: pd.DataFrame) -> dict:
    """Reference distribution for drift detection: bin edges + the actual
    training proportion per bin for each numeric feature, and category
    proportions for the categorical feature. The Worker buckets live traffic
    into these same bins later and compares proportions (PSI) — it never
    needs the raw training data.

    Deciles collapse to fewer bins when a column has many duplicate values
    (e.g. balances that are frequently exactly 0), so proportions are stored
    explicitly rather than assumed uniform."""
    numeric = {}
    for col in NUMERIC_FEATURES:
        edges = sorted(set(df[col].quantile([i / 10 for i in range(11)]).tolist()))
        if len(edges) < 2:  # a near-constant column collapses to one bin
            edges = [df[col].min(), df[col].max() + 1]
        bins = pd.cut(df[col], bins=edges, include_lowest=True)
        proportions = bins.value_counts(normalize=True, sort=False).tolist()
        numeric[col] = {"bin_edges": edges, "bin_proportions": proportions}

    categorical = {col: df[col].value_counts(normalize=True).to_dict() for col in CATEGORICAL_FEATURES}
    return {"numeric": numeric, "categorical": categorical}


def train(csv_path: str, sample_size: int, version: str) -> None:
    df = load_data(csv_path, sample_size)
    x_train, x_test, y_train, y_test = train_test_split(
        df[FEATURE_COLUMNS], df[LABEL_COLUMN], test_size=0.2, stratify=df[LABEL_COLUMN], random_state=42
    )

    pipeline = Pipeline(
        [
            ("preprocess", build_preprocessor()),
            ("classifier", LogisticRegression(class_weight="balanced", max_iter=1000)),
        ]
    )
    pipeline.fit(x_train, y_train)

    probabilities = pipeline.predict_proba(x_test)[:, 1]
    predictions = pipeline.predict(x_test)
    report = classification_report(y_test, predictions, output_dict=True)
    auc = roc_auc_score(y_test, probabilities)
    print(classification_report(y_test, predictions))
    print(f"ROC-AUC: {auc:.4f}")

    os.makedirs(ARTIFACT_DIR, exist_ok=True)
    joblib.dump(pipeline, os.path.join(ARTIFACT_DIR, "model.joblib"))

    baseline = compute_baseline(df)
    with open(os.path.join(ARTIFACT_DIR, "baseline.json"), "w") as f:
        json.dump(baseline, f, indent=2)

    metadata = {
        "model": "fraud-detector",
        "version": version,
        "framework": "scikit-learn",
        "features": {col: "float" for col in NUMERIC_FEATURES} | {col: "string" for col in CATEGORICAL_FEATURES},
        "training_rows": len(df),
        "fraud_rate": float(df[LABEL_COLUMN].mean()),
        "metrics": {"roc_auc": auc, "f1_fraud": report["1"]["f1-score"]},
    }
    with open(os.path.join(ARTIFACT_DIR, "metadata.json"), "w") as f:
        json.dump(metadata, f, indent=2)
    print(f"Saved model + metadata to {ARTIFACT_DIR}/")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", default=os.path.join(os.path.dirname(__file__), "data", "paysim.csv"))
    parser.add_argument("--sample-size", type=int, default=200_000)
    parser.add_argument("--version", default="v1")
    args = parser.parse_args()
    train(args.csv, args.sample_size, args.version)
