"""
FastAPI Microservice — ML-01 + ML-02
Exposes: GET /health, POST /predict/category, POST /predict/spending
"""

import os
import sys
import joblib
import numpy as np
from typing import Optional, List
from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel, Field

import io
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if sys.stderr and hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

# Ensure local imports work cleanly
sys.path.append(os.path.abspath(os.path.dirname(__file__)))
from preprocessing.text_preprocessor import create_combined_text_feature

# ─── ML-01 constants ────────────────────────────────────────────────────────
ML01_MODEL_NAME = "category_tfidf_logistic_regression"
ML01_MODEL_VERSION = "1.0.0"

# ─── ML-02 constants ────────────────────────────────────────────────────────
ML02_MODEL_VERSION = "ml-02-v1"

# ─── ML-03 constants ────────────────────────────────────────────────────────
ML03_MODEL_NAME = "IsolationForest"
ML03_MODEL_VERSION = "ml-03-v1"

ML02_FEATURE_COLS = [
    "previous_month_spend",
    "spend_2_months_ago",
    "spend_3_months_ago",
    "avg_3_month_spend",
    "purchase_count",
    "avg_purchase_amount",
    "online_purchase_ratio",
    "electronics_spend",
    "fashion_spend",
    "food_spend",
    "home_spend",
    "other_spend",
]

app = FastAPI(
    title="WarrantyVault ML Service",
    description="ML-01 Category Classification + ML-02 Spending Forecasting + ML-03 Spending Anomaly Detection + ML-04 Purchase Behavior Clustering",
    version="4.0.0",
)

# ─── Global model containers ─────────────────────────────────────────────────
category_model = None
spending_model = None
spending_model_name = "UnknownRegressor"
anomaly_model = None

# ─── ML-04 behavior clustering ───────────────────────────────────────────────
behavior_model = None        # dict: {scaler, kmeans, feature_names, selected_k, model_name, model_version}
behavior_profiles = {}       # dict: cluster_id -> profile dict

ML04_MODEL_NAME = "purchase_behavior_kmeans"
ML04_MODEL_VERSION = "1.0.0"
ML04_FEATURE_COLS = [
    "purchase_count",
    "monthly_spend",
    "avg_purchase_amount",
    "online_purchase_ratio",
    "electronics_spend",
    "fashion_spend",
    "food_spend",
    "home_spend",
    "other_spend",
    "avg_days_between_purchases",
]


def _models_dir() -> str:
    return os.path.join(os.path.abspath(os.path.dirname(__file__)), "models")


def _artifacts_dir() -> str:
    return os.path.join(os.path.abspath(os.path.dirname(__file__)), "artifacts")


@app.on_event("startup")
def load_models_on_startup():
    global category_model, spending_model, spending_model_name, anomaly_model

    # ── ML-01: category classifier ──
    cat_path = os.path.join(_models_dir(), "category_classifier.joblib")
    if os.path.exists(cat_path):
        try:
            category_model = joblib.load(cat_path)
            print(f"====================================================")
            print(f"🤖 [ML-01] Loaded category classifier: {cat_path}")
            print(f"🏷️  Model: {ML01_MODEL_NAME} v{ML01_MODEL_VERSION}")
            print(f"====================================================")
        except Exception as e:
            print(f"⚠️ [ML-01] Failed to load category model: {e}")
    else:
        print(f"⚠️ [ML-01] category_classifier.joblib not found.")
        print(f"   Run: python training/train_category_model.py")

    # ── ML-02: spending forecasting ──
    spend_path = os.path.join(_models_dir(), "spending_forecasting_model.joblib")
    meta_path = os.path.join(_models_dir(), "spending_forecasting_metadata.json")
    if os.path.exists(spend_path):
        try:
            spending_model = joblib.load(spend_path)
            if os.path.exists(meta_path):
                import json
                with open(meta_path, "r") as f:
                    meta = json.load(f)
                spending_model_name = meta.get("modelName", "UnknownRegressor")
            print(f"====================================================")
            print(f"📈 [ML-02] Loaded spending forecasting model: {spend_path}")
            print(f"🏷️  Model: {spending_model_name} v{ML02_MODEL_VERSION}")
            print(f"====================================================")
        except Exception as e:
            print(f"⚠️ [ML-02] Failed to load spending model: {e}")
    else:
        print(f"⚠️ [ML-02] spending_forecasting_model.joblib not found.")
        print(f"   Run: python training/train_spending_model.py")

    # ── ML-03: spending anomaly detector ──
    anomaly_path = os.path.join(_models_dir(), "anomaly_detector.joblib")
    if not os.path.exists(anomaly_path):
        print("🤖 [ML-03] anomaly_detector.joblib not found. Training model now...")
        try:
            from training.train_anomaly_model import train_and_evaluate
            train_and_evaluate()
        except Exception as e:
            print(f"⚠️ [ML-03] Auto-training error: {e}")

    if os.path.exists(anomaly_path):
        try:
            anomaly_model = joblib.load(anomaly_path)
            print(f"====================================================")
            print(f"🌲 [ML-03] Loaded spending anomaly detector: {anomaly_path}")
            print(f"🏷️  Model: {ML03_MODEL_NAME} v{ML03_MODEL_VERSION}")
            print(f"====================================================")
        except Exception as e:
            print(f"⚠️ [ML-03] Failed to load anomaly detector: {e}")

    # ── ML-04: purchase behavior clustering ──
    global behavior_model, behavior_profiles
    behavior_path = os.path.join(_models_dir(), "purchase_behavior_clustering_model.joblib")
    profiles_path = os.path.join(_artifacts_dir(), "cluster_profiles.json")
    if os.path.exists(behavior_path):
        try:
            import json
            behavior_model = joblib.load(behavior_path)
            if os.path.exists(profiles_path):
                with open(profiles_path, "r", encoding="utf-8") as f:
                    behavior_profiles = json.load(f)
            k = behavior_model.get("selected_k", "?")
            print(f"====================================================")
            print(f"🧩 [ML-04] Loaded behavior clustering model: {behavior_path}")
            print(f"🏷️  Model: {ML04_MODEL_NAME} v{ML04_MODEL_VERSION} (k={k})")
            print(f"====================================================")
        except Exception as e:
            print(f"⚠️ [ML-04] Failed to load behavior clustering model: {e}")
    else:
        print(f"⚠️ [ML-04] purchase_behavior_clustering_model.joblib not found.")
        print(f"   Run: python training/train_clustering_model.py")


# ─── Health check ─────────────────────────────────────────────────────────────
@app.get("/health")
def health_check():
    selected_k = behavior_model.get("selected_k") if behavior_model else None
    return {
        "status": "ok",
        "service": "WarrantyVault ML Service",
        "models": {
            "categoryClassifier": {
                "loaded": category_model is not None,
                "modelName": ML01_MODEL_NAME,
                "modelVersion": ML01_MODEL_VERSION,
            },
            "spendingForecaster": {
                "loaded": spending_model is not None,
                "modelName": spending_model_name,
                "modelVersion": ML02_MODEL_VERSION,
            },
            "anomalyDetector": {
                "loaded": anomaly_model is not None,
                "modelName": ML03_MODEL_NAME,
                "modelVersion": ML03_MODEL_VERSION,
            },
            "behaviorClusterer": {
                "loaded": behavior_model is not None,
                "modelName": ML04_MODEL_NAME,
                "modelVersion": ML04_MODEL_VERSION,
                "selectedK": selected_k,
            },
        },
    }


# ─── ML-01: Category prediction ───────────────────────────────────────────────
class PredictCategoryRequest(BaseModel):
    product_name: Optional[str] = Field(default="", alias="productName")
    brand: Optional[str] = Field(default="")
    merchant: Optional[str] = Field(default="", alias="storeName")
    description: Optional[str] = Field(default="", alias="rawOcrText")
    purchase_type: Optional[str] = Field(default="", alias="purchaseType")
    amount: Optional[float] = Field(default=None, alias="price")

    class Config:
        populate_by_name = True


class TopPrediction(BaseModel):
    category: str
    confidence: float


class PredictCategoryResponse(BaseModel):
    success: bool
    modelName: str
    modelVersion: str
    predictedCategory: str
    confidence: float
    topPredictions: List[TopPrediction]


@app.post("/predict/category", response_model=PredictCategoryResponse)
def predict_category(request: PredictCategoryRequest):
    global category_model

    if category_model is None:
        path = os.path.join(_models_dir(), "category_classifier.joblib")
        if os.path.exists(path):
            try:
                category_model = joblib.load(path)
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Model load error: {e}")
        else:
            raise HTTPException(
                status_code=503,
                detail="Category model not found. Run: python training/train_category_model.py",
            )

    input_data = request.dict()
    combined_text = create_combined_text_feature(input_data)

    if not combined_text or not combined_text.strip():
        raise HTTPException(
            status_code=400,
            detail="At least one of product_name, brand, merchant, or description is required.",
        )

    try:
        probabilities = category_model.predict_proba([combined_text])[0]
        classes = category_model.classes_
        class_probs = sorted(
            zip(classes, probabilities), key=lambda x: x[1], reverse=True
        )
        top_cat, top_conf = class_probs[0]
        top3 = [TopPrediction(category=c, confidence=round(p, 4)) for c, p in class_probs[:3]]

        return PredictCategoryResponse(
            success=True,
            modelName=ML01_MODEL_NAME,
            modelVersion=ML01_MODEL_VERSION,
            predictedCategory=str(top_cat),
            confidence=round(float(top_conf), 4),
            topPredictions=top3,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {e}")


# ─── ML-02: Spending forecast ─────────────────────────────────────────────────
class PredictSpendingRequest(BaseModel):
    previous_month_spend: float
    spend_2_months_ago: float
    spend_3_months_ago: float
    avg_3_month_spend: float
    purchase_count: int
    avg_purchase_amount: float
    online_purchase_ratio: float
    electronics_spend: float
    fashion_spend: float
    food_spend: float
    home_spend: float
    other_spend: float


class PredictSpendingResponse(BaseModel):
    success: bool
    predictedNextMonthSpend: float
    modelName: str
    modelVersion: str


@app.post("/predict/spending", response_model=PredictSpendingResponse)
def predict_spending(request: PredictSpendingRequest):
    global spending_model, spending_model_name

    if spending_model is None:
        path = os.path.join(_models_dir(), "spending_forecasting_model.joblib")
        if os.path.exists(path):
            try:
                spending_model = joblib.load(path)
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Model load error: {e}")
        else:
            raise HTTPException(
                status_code=503,
                detail="Spending model not found. Run: python training/train_spending_model.py",
            )

    if request.online_purchase_ratio < 0 or request.online_purchase_ratio > 1:
        raise HTTPException(
            status_code=400,
            detail="online_purchase_ratio must be between 0.0 and 1.0",
        )

    try:
        feature_vector = np.array([[
            request.previous_month_spend,
            request.spend_2_months_ago,
            request.spend_3_months_ago,
            request.avg_3_month_spend,
            request.purchase_count,
            request.avg_purchase_amount,
            request.online_purchase_ratio,
            request.electronics_spend,
            request.fashion_spend,
            request.food_spend,
            request.home_spend,
            request.other_spend,
        ]])

        raw_prediction = float(spending_model.predict(feature_vector)[0])
        # Clamp to non-negative
        predicted = round(max(raw_prediction, 0.0), 2)

        return PredictSpendingResponse(
            success=True,
            predictedNextMonthSpend=predicted,
            modelName=spending_model_name,
            modelVersion=ML02_MODEL_VERSION,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Spending prediction failed: {e}")


# ─── ML-03: Spending Anomaly Detection ─────────────────────────────────────────
class PredictAnomalyRequest(BaseModel):
    purchase_amount: float = Field(..., description="Purchase transaction amount")
    user_monthly_spend: float = Field(..., description="Total spend by user in last 30 days")
    category_average_purchase: float = Field(..., description="User's average purchase amount in this category")
    purchase_count_last_30_days: int = Field(..., description="Number of purchases made in last 30 days")
    days_since_last_purchase: int = Field(..., description="Days elapsed since user's previous purchase")
    amount_to_monthly_spend_ratio: float = Field(..., description="purchase_amount / user_monthly_spend ratio")
    amount_to_category_average_ratio: float = Field(..., description="purchase_amount / category_average_purchase ratio")


class PredictAnomalyResponse(BaseModel):
    success: bool
    isAnomaly: bool
    anomalyScore: float
    modelName: str
    modelVersion: str


@app.post("/predict/anomaly", response_model=PredictAnomalyResponse)
def predict_anomaly(request: PredictAnomalyRequest):
    global anomaly_model

    if anomaly_model is None:
        path = os.path.join(_models_dir(), "anomaly_detector.joblib")
        if os.path.exists(path):
            try:
                anomaly_model = joblib.load(path)
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Model load error: {e}")
        else:
            raise HTTPException(
                status_code=503,
                detail="Anomaly detection model not found. Run: python training/train_anomaly_model.py",
            )

    # Input validations
    if request.purchase_amount < 0:
        raise HTTPException(status_code=400, detail="purchase_amount cannot be negative")
    if request.user_monthly_spend < 0:
        raise HTTPException(status_code=400, detail="user_monthly_spend cannot be negative")
    if request.category_average_purchase < 0:
        raise HTTPException(status_code=400, detail="category_average_purchase cannot be negative")
    if request.purchase_count_last_30_days < 0:
        raise HTTPException(status_code=400, detail="purchase_count_last_30_days cannot be negative")
    if request.days_since_last_purchase < 0:
        raise HTTPException(status_code=400, detail="days_since_last_purchase cannot be negative")

    try:
        feature_vector = np.array([[
            request.purchase_amount,
            request.user_monthly_spend,
            request.category_average_purchase,
            request.purchase_count_last_30_days,
            request.days_since_last_purchase,
            request.amount_to_monthly_spend_ratio,
            request.amount_to_category_average_ratio
        ]])

        # IsolationForest prediction: -1 = anomaly, 1 = normal
        pred_label = int(anomaly_model.predict(feature_vector)[0])
        is_anomaly = bool(pred_label == -1)

        # IsolationForest decision function score
        score = float(anomaly_model.decision_function(feature_vector)[0])

        return PredictAnomalyResponse(
            success=True,
            isAnomaly=is_anomaly,
            anomalyScore=round(score, 4),
            modelName=ML03_MODEL_NAME,
            modelVersion=ML03_MODEL_VERSION
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Anomaly prediction failed: {e}")


# ─── ML-04: Purchase Behavior Clustering ─────────────────────────────────────
class PredictBehaviorRequest(BaseModel):
    purchase_count: float = Field(..., ge=0, description="Monthly purchase count")
    monthly_spend: float = Field(..., ge=0, description="Total monthly spend")
    avg_purchase_amount: float = Field(..., ge=0, description="Average amount per purchase")
    online_purchase_ratio: float = Field(..., ge=0.0, le=1.0, description="Ratio of online purchases (0–1)")
    electronics_spend: float = Field(..., ge=0.0, le=1.0, description="Electronics spend ratio (0–1)")
    fashion_spend: float = Field(..., ge=0.0, le=1.0, description="Fashion spend ratio (0–1)")
    food_spend: float = Field(..., ge=0.0, le=1.0, description="Food spend ratio (0–1)")
    home_spend: float = Field(..., ge=0.0, le=1.0, description="Home spend ratio (0–1)")
    other_spend: float = Field(..., ge=0.0, le=1.0, description="Other spend ratio (0–1)")
    avg_days_between_purchases: float = Field(..., ge=0, description="Average days between purchases")


class PredictBehaviorResponse(BaseModel):
    success: bool
    cluster: int
    clusterName: str
    description: str
    characteristics: List[str]
    clusterSize: int
    clusterPercentage: float
    modelName: str
    modelVersion: str


@app.post("/predict/behavior", response_model=PredictBehaviorResponse)
def predict_behavior(request: PredictBehaviorRequest):
    global behavior_model, behavior_profiles

    # Lazy-load if not loaded yet
    if behavior_model is None:
        path = os.path.join(_models_dir(), "purchase_behavior_clustering_model.joblib")
        if os.path.exists(path):
            try:
                behavior_model = joblib.load(path)
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Behavior model load error: {e}")
        else:
            raise HTTPException(
                status_code=503,
                detail="Behavior clustering model not found. Run: python training/train_clustering_model.py",
            )

    if not behavior_profiles:
        import json
        profiles_path = os.path.join(_artifacts_dir(), "cluster_profiles.json")
        if os.path.exists(profiles_path):
            with open(profiles_path, "r", encoding="utf-8") as f:
                behavior_profiles = json.load(f)

    # Build feature vector in the exact order the model was trained on
    try:
        feature_vector = np.array([[
            request.purchase_count,
            request.monthly_spend,
            request.avg_purchase_amount,
            request.online_purchase_ratio,
            request.electronics_spend,
            request.fashion_spend,
            request.food_spend,
            request.home_spend,
            request.other_spend,
            request.avg_days_between_purchases,
        ]])
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid input features: {e}")

    try:
        scaler = behavior_model["scaler"]
        kmeans = behavior_model["kmeans"]

        X_scaled = scaler.transform(feature_vector)
        cluster_id = int(kmeans.predict(X_scaled)[0])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {e}")

    # Look up cluster profile (data-driven, not hardcoded)
    profile = behavior_profiles.get(str(cluster_id), {})
    cluster_name = profile.get("name", f"Cluster {cluster_id}")
    cluster_desc = profile.get("description", "Purchase behavior cluster.")
    characteristics = profile.get("characteristics", [])
    cluster_size = profile.get("size", 0)
    cluster_pct = profile.get("percentage", 0.0)

    return PredictBehaviorResponse(
        success=True,
        cluster=cluster_id,
        clusterName=cluster_name,
        description=cluster_desc,
        characteristics=characteristics,
        clusterSize=cluster_size,
        clusterPercentage=cluster_pct,
        modelName=ML04_MODEL_NAME,
        modelVersion=ML04_MODEL_VERSION,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)

