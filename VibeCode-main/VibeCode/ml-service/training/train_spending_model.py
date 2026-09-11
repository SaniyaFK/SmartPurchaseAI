"""
ML-02 Spending Forecasting Training Script.
Trains Linear Regression and Random Forest Regressor on ML_02_spending_forecasting.csv.
Model selection is based on RMSE (primary metric); MAE and R2 are supporting metrics.
Saves best model, metrics, and metadata to ml-service/models/.
"""

import os
import sys
import json
import datetime
import pandas as pd
import numpy as np
import joblib

from sklearn.model_selection import train_test_split
from sklearn.linear_model import LinearRegression
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

MODEL_VERSION = "ml-02-v1"
TARGET = "next_month_spend"
DATASET_NAME = "ML_02_spending_forecasting.csv"

# Features used for training — aligned with calculateUserSpendingFeatures in purchaseService.js
FEATURE_COLS = [
    "previous_month_spend",   # total spend in month M-1 (most recent complete month)
    "spend_2_months_ago",     # total spend in month M-2
    "spend_3_months_ago",     # total spend in month M-3
    "avg_3_month_spend",      # mean of M-1, M-2, M-3 spend
    "purchase_count",         # count of all purchases in M-1
    "avg_purchase_amount",    # average transaction amount in M-1 (total M-1 spend / purchase_count)
    "online_purchase_ratio",  # fraction of M-1 purchases with purchaseType == ONLINE
    "electronics_spend",      # sum of M-1 spend in Electronics category
    "fashion_spend",          # sum of M-1 spend in Fashion category
    "food_spend",             # sum of M-1 spend in Food & Beverages + Food & Groceries
    "home_spend",             # sum of M-1 spend in Home Appliances + Furniture
    "other_spend",            # sum of M-1 spend in all remaining categories
]


def find_dataset(base_dir: str) -> str:
    """Search upward through directory tree to find the CSV dataset."""
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
        f"Dataset '{DATASET_NAME}' not found. Place it in ml-service/data/ or the project root."
    )


def validate_dataset(df: pd.DataFrame) -> None:
    print(f"\n--- Dataset Validation ---")
    print(f"  Shape:          {df.shape[0]} rows × {df.shape[1]} columns")
    print(f"  Columns:        {list(df.columns)}")
    missing = df.isnull().sum()
    if missing.any():
        print(f"  ⚠️ Missing values:\n{missing[missing > 0]}")
    else:
        print(f"  ✅ No missing values")
    dupes = df.duplicated().sum()
    print(f"  Duplicate rows: {dupes}")
    print(f"\n  Target ({TARGET}) statistics:")
    print(df[TARGET].describe().to_string())

    # Check for impossible values (negative amounts)
    for col in FEATURE_COLS + [TARGET]:
        if col in df.columns and df[col].dtype in [np.float64, np.int64]:
            neg = (df[col] < 0).sum()
            if neg > 0:
                print(f"  ⚠️ {neg} negative values found in '{col}'")
    print()


def compute_metrics(y_true, y_pred, model_name: str) -> dict:
    mae = float(mean_absolute_error(y_true, y_pred))
    mse = float(mean_squared_error(y_true, y_pred))
    rmse = float(np.sqrt(mse))
    r2 = float(r2_score(y_true, y_pred))
    print(f"\n  [{model_name}]")
    print(f"    RMSE (primary): {rmse:,.2f}")
    print(f"    MAE:            {mae:,.2f}")
    print(f"    MSE:            {mse:,.2f}")
    print(f"    R²:             {r2:.4f}")
    return {"mae": round(mae, 4), "mse": round(mse, 4), "rmse": round(rmse, 4), "r2": round(r2, 4)}


def train_model():
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    data_path = find_dataset(base_dir)

    print("====================================================")
    print("📊 ML-02 Spending Forecasting Model Training")
    print(f"📂 Dataset: {data_path}")
    print("====================================================")

    df = pd.read_csv(data_path)
    validate_dataset(df)

    # Validate required columns
    missing_cols = [c for c in FEATURE_COLS + [TARGET] if c not in df.columns]
    if missing_cols:
        raise ValueError(f"Dataset missing required columns: {missing_cols}")

    X = df[FEATURE_COLS]
    y = df[TARGET]

    # 80/20 stratified-by-value split (random, not temporal — dataset rows are already independent observations)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, random_state=42
    )
    print(f"Split strategy:  80/20 random (random_state=42)")
    print(f"Training rows:   {len(X_train)}")
    print(f"Testing rows:    {len(X_test)}")
    print(f"Feature columns: {FEATURE_COLS}\n")

    # -----------------------------------------------------------------------
    # Model A: Linear Regression with StandardScaler (scaling required)
    # -----------------------------------------------------------------------
    lr_pipeline = Pipeline([
        ("scaler", StandardScaler()),
        ("model", LinearRegression())
    ])
    lr_pipeline.fit(X_train, y_train)
    y_pred_lr = lr_pipeline.predict(X_test)
    metrics_lr = compute_metrics(y_test, y_pred_lr, "LinearRegression")

    # -----------------------------------------------------------------------
    # Model B: Random Forest Regressor — no scaling (tree model is scale-invariant)
    # -----------------------------------------------------------------------
    rf_model = RandomForestRegressor(n_estimators=100, random_state=42, n_jobs=-1)
    rf_model.fit(X_train, y_train)
    y_pred_rf = rf_model.predict(X_test)
    metrics_rf = compute_metrics(y_test, y_pred_rf, "RandomForestRegressor")

    # -----------------------------------------------------------------------
    # Model Selection: Primary metric is RMSE (lower is better)
    # MAE and R² are logged as supporting information only.
    # -----------------------------------------------------------------------
    print("\n--- Model Selection (Primary Metric: RMSE) ---")
    if metrics_rf["rmse"] <= metrics_lr["rmse"]:
        selected_name = "RandomForestRegressor"
        selected_model = rf_model
        selected_metrics = metrics_rf
        reason = f"Random Forest RMSE ({metrics_rf['rmse']:,.2f}) ≤ Linear Regression RMSE ({metrics_lr['rmse']:,.2f})"
    else:
        selected_name = "LinearRegression"
        selected_model = lr_pipeline
        selected_metrics = metrics_lr
        reason = f"Linear Regression RMSE ({metrics_lr['rmse']:,.2f}) < Random Forest RMSE ({metrics_rf['rmse']:,.2f})"
    print(f"  ✅ Selected: {selected_name}")
    print(f"  Reason:     {reason}")

    # Ensure models directory exists
    models_dir = os.path.join(base_dir, "models")
    os.makedirs(models_dir, exist_ok=True)

    # Save selected model
    model_path = os.path.join(models_dir, "spending_forecasting_model.joblib")
    joblib.dump(selected_model, model_path)
    print(f"\n✅ Saved model to: {model_path}")

    # Save metrics JSON
    metrics_data = {
        "modelVersion": MODEL_VERSION,
        "target": TARGET,
        "selectedModel": selected_name,
        "selectionCriteria": "Lowest RMSE on test set (primary); MAE and R² as supporting metrics",
        "splitStrategy": "80/20 random split, random_state=42",
        "trainingRows": len(X_train),
        "testingRows": len(X_test),
        "featureNames": FEATURE_COLS,
        "models": {
            "LinearRegression": metrics_lr,
            "RandomForestRegressor": metrics_rf
        },
        "selectedModelMetrics": selected_metrics
    }
    metrics_path = os.path.join(models_dir, "spending_forecasting_metrics.json")
    with open(metrics_path, "w", encoding="utf-8") as f:
        json.dump(metrics_data, f, indent=2)
    print(f"✅ Saved metrics to: {metrics_path}")

    # Save metadata JSON
    metadata = {
        "modelName": selected_name,
        "modelVersion": MODEL_VERSION,
        "target": TARGET,
        "featureNames": FEATURE_COLS,
        "featureDefinitions": {
            "previous_month_spend": "Total purchase spend in month M-1 (most recent complete month)",
            "spend_2_months_ago": "Total purchase spend in month M-2",
            "spend_3_months_ago": "Total purchase spend in month M-3",
            "avg_3_month_spend": "Arithmetic mean of previous_month_spend, spend_2_months_ago, spend_3_months_ago",
            "purchase_count": "Count of all purchase records in M-1",
            "avg_purchase_amount": "previous_month_spend / purchase_count (0 if purchase_count == 0)",
            "online_purchase_ratio": "Fraction of M-1 purchases with purchaseType == 'ONLINE' (0.0 to 1.0)",
            "electronics_spend": "Sum of M-1 spend where category == 'Electronics'",
            "fashion_spend": "Sum of M-1 spend where category == 'Fashion'",
            "food_spend": "Sum of M-1 spend where category in ['Food & Beverages', 'Food & Groceries']",
            "home_spend": "Sum of M-1 spend where category in ['Home Appliances', 'Furniture']",
            "other_spend": "Sum of M-1 spend in all remaining categories"
        },
        "datasetName": DATASET_NAME,
        "trainedAt": datetime.datetime.utcnow().isoformat() + "Z"
    }
    metadata_path = os.path.join(models_dir, "spending_forecasting_metadata.json")
    with open(metadata_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)
    print(f"✅ Saved metadata to: {metadata_path}")
    print("====================================================")

    return metrics_data


if __name__ == "__main__":
    train_model()
