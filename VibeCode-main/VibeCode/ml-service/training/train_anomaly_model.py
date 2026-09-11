"""
ML-03 Spending Anomaly Detection Training Script.
Trains an unsupervised Isolation Forest model (sklearn.ensemble.IsolationForest)
on ML_03_spending_anomaly_detection.csv to detect spending anomalies.

Evaluates predictions against synthetic 'is_anomaly' reference labels.
Neither 'is_anomaly' nor 'user_id' are used as input features during training.
Saves model, metrics, and metadata to ml-service/models/.
"""

import os
import sys
import json
import datetime
import pandas as pd
import numpy as np
import joblib

from sklearn.ensemble import IsolationForest
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    confusion_matrix,
    classification_report
)

MODEL_VERSION = "ml-03-v1"
MODEL_NAME = "IsolationForest"
DATASET_NAME = "ML_03_spending_anomaly_detection.csv"

# 7 Numerical features required for ML-03 training
FEATURE_COLS = [
    "purchase_amount",
    "user_monthly_spend",
    "category_average_purchase",
    "purchase_count_last_30_days",
    "days_since_last_purchase",
    "amount_to_monthly_spend_ratio",
    "amount_to_category_average_ratio",
]

TARGET_COL = "is_anomaly"


def find_dataset(base_dir: str) -> str:
    """Search upward through directory tree to locate ML_03_spending_anomaly_detection.csv."""
    current = base_dir
    for _ in range(6):
        for subdir in ["data", "."]:
            candidate = os.path.join(current, subdir, DATASET_NAME)
            if os.path.exists(candidate):
                return candidate
        parent = os.path.dirname(current)
        if parent == current:
            break
        current = parent
    raise FileNotFoundError(
        f"Dataset '{DATASET_NAME}' not found. Place it in ml-service/data/ or project root."
    )


def validate_and_clean_dataset(df: pd.DataFrame) -> pd.DataFrame:
    """
    Perform thorough validation on the dataset.
    Prints statistics, missing values, duplicates, and checks for invalid negative values.
    """
    print("\n==================================================")
    print("📊 [ML-03] DATASET VALIDATION REPORT")
    print("==================================================")
    print(f"Dataset Shape: {df.shape[0]} rows, {df.shape[1]} columns")
    print(f"Columns: {list(df.columns)}")
    print("\n--- Data Types ---")
    print(df.dtypes)

    # Missing values check
    null_counts = df.isnull().sum()
    print("\n--- Missing Values ---")
    print(null_counts[null_counts > 0] if null_counts.sum() > 0 else "No missing values found.")

    # Duplicate rows check
    duplicates = df.duplicated().sum()
    print(f"\nDuplicate Rows: {duplicates}")

    # Label distribution check
    if TARGET_COL in df.columns:
        anomaly_counts = df[TARGET_COL].value_counts()
        actual_anomaly_count = int(anomaly_counts.get(1, 0))
        total_count = len(df)
        actual_anomaly_pct = round((actual_anomaly_count / total_count) * 100, 2)
        print("\n--- Anomaly Label Distribution (Reference Ground Truth) ---")
        print(f"Normal (0): {total_count - actual_anomaly_count}")
        print(f"Anomaly (1): {actual_anomaly_count} ({actual_anomaly_pct}%)")

    # Range and invalid value checks
    print("\n--- Feature Summary Statistics ---")
    stats = df[FEATURE_COLS].describe().T[["min", "mean", "max"]]
    print(stats)

    # Negative value checks
    invalid_negatives = {}
    for col in FEATURE_COLS:
        neg_count = (df[col] < 0).sum()
        if neg_count > 0:
            invalid_negatives[col] = neg_count

    if invalid_negatives:
        print("\n⚠️ WARNING: Found negative values in feature columns:")
        for col, count in invalid_negatives.items():
            print(f"   - {col}: {count} negative records")
    else:
        print("\n✅ All feature values are non-negative and valid.")

    return df


def train_and_evaluate():
    base_dir = os.path.abspath(os.path.dirname(__file__))
    ml_service_dir = os.path.dirname(base_dir)
    models_dir = os.path.join(ml_service_dir, "models")
    os.makedirs(models_dir, exist_ok=True)

    # Locate dataset
    data_path = find_dataset(base_dir)
    print(f"📁 Loading dataset from: {data_path}")
    df = pd.read_csv(data_path)

    # Validate dataset
    df = validate_and_clean_dataset(df)

    # Extract feature matrix X (strict: no is_anomaly, no user_id)
    X = df[FEATURE_COLS].copy()
    y_true = df[TARGET_COL].values if TARGET_COL in df.columns else None

    # Calculate exact anomaly ratio for contamination
    total_records = len(df)
    actual_anomaly_count = int((y_true == 1).sum()) if y_true is not None else 0
    contamination_rate = round(actual_anomaly_count / total_records, 4)
    if contamination_rate <= 0 or contamination_rate >= 0.5:
        contamination_rate = 0.08  # Default fallback

    print(f"\n==================================================")
    print(f"🌲 [ML-03] TRAINING ISOLATION FOREST")
    print(f"==================================================")
    print(f"Contamination Rate Selected: {contamination_rate} ({contamination_rate * 100:.2f}%)")
    print(f"Random State: 42")
    print(f"Input Features ({len(FEATURE_COLS)}): {FEATURE_COLS}")

    # Instantiate and fit IsolationForest
    iso_forest = IsolationForest(
        contamination=contamination_rate,
        random_state=42,
        n_estimators=100
    )
    iso_forest.fit(X)

    # Generate predictions: IsolationForest returns -1 for anomaly, 1 for normal
    raw_preds = iso_forest.predict(X)
    # Map: -1 -> 1 (anomaly), 1 -> 0 (normal)
    y_pred = np.where(raw_preds == -1, 1, 0)

    # Compute decision function scores
    scores = iso_forest.decision_function(X)

    predicted_anomaly_count = int((y_pred == 1).sum())
    predicted_anomaly_pct = round((predicted_anomaly_count / total_records) * 100, 2)

    # Evaluation against ground truth synthetic labels
    metrics_dict = {}
    cm_list = [[0, 0], [0, 0]]
    if y_true is not None:
        acc = float(accuracy_score(y_true, y_pred))
        prec = float(precision_score(y_true, y_pred, zero_division=0))
        rec = float(recall_score(y_true, y_pred, zero_division=0))
        f1 = float(f1_score(y_true, y_pred, zero_division=0))
        cm = confusion_matrix(y_true, y_pred)
        cm_list = cm.tolist()

        metrics_dict = {
            "accuracy": round(acc, 4),
            "precision": round(prec, 4),
            "recall": round(rec, 4),
            "f1": round(f1, 4)
        }

        print("\n==================================================")
        print("📈 [ML-03] EVALUATION METRICS (VS GROUND TRUTH)")
        print("==================================================")
        print(f"Accuracy : {acc:.4f} ({acc * 100:.2f}%)")
        print(f"Precision: {prec:.4f}")
        print(f"Recall   : {rec:.4f}")
        print(f"F1-Score : {f1:.4f}")
        print("\nConfusion Matrix [ [TN, FP], [FN, TP] ]:")
        print(cm)
        print("\nClassification Report:")
        print(classification_report(y_true, y_pred, target_names=["Normal", "Anomaly"]))

    # 1. Save Trained Model
    model_path = os.path.join(models_dir, "anomaly_detector.joblib")
    joblib.dump(iso_forest, model_path)
    print(f"💾 Model saved to: {model_path}")

    # 2. Save Metrics JSON
    metrics_payload = {
        "modelName": MODEL_NAME,
        "modelVersion": MODEL_VERSION,
        "contamination": contamination_rate,
        "features": FEATURE_COLS,
        "metrics": metrics_dict,
        "confusionMatrix": cm_list,
        "totalRecords": total_records,
        "actualAnomalyCount": actual_anomaly_count,
        "actualAnomalyPercentage": round((actual_anomaly_count / total_records) * 100, 2),
        "predictedAnomalyCount": predicted_anomaly_count,
        "predictedAnomalyPercentage": predicted_anomaly_pct,
        "evaluatedAt": datetime.datetime.utcnow().isoformat() + "Z"
    }

    metrics_path = os.path.join(models_dir, "anomaly_detection_metrics.json")
    with open(metrics_path, "w") as f:
        json.dump(metrics_payload, f, indent=2)
    print(f"📄 Metrics saved to: {metrics_path}")

    # 3. Save Metadata JSON
    metadata_payload = {
        "modelName": MODEL_NAME,
        "modelVersion": MODEL_VERSION,
        "algorithm": "IsolationForest",
        "features": FEATURE_COLS,
        "contamination": contamination_rate,
        "trainingRecordCount": total_records,
        "datasetName": DATASET_NAME,
        "randomState": 42,
        "trainingDate": datetime.datetime.utcnow().isoformat() + "Z"
    }

    metadata_path = os.path.join(models_dir, "anomaly_detection_metadata.json")
    with open(metadata_path, "w") as f:
        json.dump(metadata_payload, f, indent=2)
    print(f"📄 Metadata saved to: {metadata_path}")

    print("\n==================================================")
    print("✨ ML-03 Isolation Forest Model Training Complete!")
    print("==================================================")


if __name__ == "__main__":
    train_and_evaluate()
