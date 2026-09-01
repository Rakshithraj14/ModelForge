"""Shared PaySim feature schema, used by both train.py and app.py so the
preprocessing pipeline trained offline exactly matches what /predict builds
from a request at inference time."""

from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder, StandardScaler

NUMERIC_FEATURES = [
    "amount",
    "oldbalanceOrg",
    "newbalanceOrig",
    "oldbalanceDest",
    "newbalanceDest",
]
CATEGORICAL_FEATURES = ["type"]
FEATURE_COLUMNS = NUMERIC_FEATURES + CATEGORICAL_FEATURES
LABEL_COLUMN = "isFraud"
TRANSACTION_TYPES = ["CASH_IN", "CASH_OUT", "DEBIT", "PAYMENT", "TRANSFER"]


def build_preprocessor() -> ColumnTransformer:
    return ColumnTransformer(
        transformers=[
            ("num", StandardScaler(), NUMERIC_FEATURES),
            (
                "cat",
                OneHotEncoder(categories=[TRANSACTION_TYPES], handle_unknown="ignore"),
                CATEGORICAL_FEATURES,
            ),
        ]
    )
