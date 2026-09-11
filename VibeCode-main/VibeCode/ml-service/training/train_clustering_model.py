"""
ML-04: Purchase Behavior Clustering Training Script
Algorithm: K-Means Clustering + StandardScaler
Dataset: ML_04_purchase_behavior_clustering.csv
"""

import os
import sys
import json
import joblib
import numpy as np
import pandas as pd
from datetime import datetime
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import silhouette_score

# System stdout UTF-8 encoding support for Windows
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if sys.stderr and hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

# Directory references
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ROOT_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", ".."))

# Locate CSV dataset
csv_candidates = [
    os.path.join(BASE_DIR, "data", "ML_04_purchase_behavior_clustering.csv"),
    os.path.join(ROOT_DIR, "ML_04_purchase_behavior_clustering.csv"),
    os.path.join(os.getcwd(), "ML_04_purchase_behavior_clustering.csv")
]

csv_path = None
for candidate in csv_candidates:
    if os.path.exists(candidate):
        csv_path = candidate
        break

if not csv_path:
    raise FileNotFoundError("ML_04_purchase_behavior_clustering.csv dataset not found!")

print(f"====================================================")
print(f"📊 [ML-04] Loading dataset: {csv_path}")
df = pd.read_csv(csv_path)
print(f"✅ Loaded {len(df)} rows and {len(df.columns)} columns.")

# 1. Dataset Validation
print("\n--- 🔍 Dataset Validation ---")
print(f"Columns present: {list(df.columns)}")
null_counts = df.isnull().sum().sum()
duplicate_rows = df.duplicated().sum()
print(f"Null values: {null_counts}")
print(f"Duplicate rows: {duplicate_rows}")

if null_counts > 0:
    df = df.dropna()
    print(f"Cleaned dataset rows: {len(df)}")

# Standardize column mappings
column_mapping = {
    'purchase_count_per_month': 'purchase_count',
    'average_purchase_amount': 'avg_purchase_amount',
    'electronics_spend_ratio': 'electronics_spend',
    'fashion_spend_ratio': 'fashion_spend',
    'food_spend_ratio': 'food_spend',
    'home_spend_ratio': 'home_spend',
    'other_spend_ratio': 'other_spend'
}
df = df.rename(columns=column_mapping)

# Check if avg_days_between_purchases is present; if missing, calculate from purchase_count
if 'avg_days_between_purchases' not in df.columns:
    df['avg_days_between_purchases'] = 30.0 / np.maximum(df['purchase_count'], 1)

FEATURE_COLS = [
    "purchase_count",
    "monthly_spend",
    "avg_purchase_amount",
    "online_purchase_ratio",
    "electronics_spend",
    "fashion_spend",
    "food_spend",
    "home_spend",
    "other_spend",
    "avg_days_between_purchases"
]

print(f"Feature set ({len(FEATURE_COLS)} features): {FEATURE_COLS}")
X = df[FEATURE_COLS].copy()

# Validate numeric constraints
for col in FEATURE_COLS:
    neg_count = (X[col] < 0).sum()
    if neg_count > 0:
        print(f"⚠️ Warning: {neg_count} negative values found in {col}. Clipping to 0.")
        X[col] = np.maximum(X[col], 0)

# Check ratio features (must be between 0 and 1)
ratio_cols = ["online_purchase_ratio", "electronics_spend", "fashion_spend", "food_spend", "home_spend", "other_spend"]
for rcol in ratio_cols:
    X[rcol] = np.clip(X[rcol], 0.0, 1.0)

print("\n--- 📈 Descriptive Statistics ---")
print(X.describe().round(2))

# 2. Feature Scaling
print("\n--- ⚖️ Feature Scaling ---")
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)

# 3. K-Means Clustering Evaluation (k = 2 to 8)
print("\n--- 🧪 Evaluating K-Means for k = 2 to 8 ---")
k_range = range(2, 9)
metrics = {}
best_k = 4
best_score = -1.0

print(f"{'k':<5} | {'Inertia':<15} | {'Silhouette Score':<20}")
print("-" * 45)

for k in k_range:
    kmeans = KMeans(n_clusters=k, random_state=42, n_init=10)
    labels = kmeans.fit_predict(X_scaled)
    inertia = float(kmeans.inertia_)
    sil_score = float(silhouette_score(X_scaled, labels))
    
    metrics[str(k)] = {
        "k": k,
        "inertia": round(inertia, 4),
        "silhouette_score": round(sil_score, 4)
    }
    
    print(f"{k:<5} | {inertia:<15.2f} | {sil_score:<20.4f}")
    
    if sil_score > best_score:
        best_score = sil_score
        best_k = k

print(f"\n🎯 Selected Optimal k = {best_k} (Highest Silhouette Score: {best_score:.4f})")

# 4. Fit Final Model
final_kmeans = KMeans(n_clusters=best_k, random_state=42, n_init=10)
final_labels = final_kmeans.fit_predict(X_scaled)
df['cluster'] = final_labels

# 5. Generate Cluster Profiles & Interpretations
print("\n--- 🏷️ Generating Cluster Profiles ---")
cluster_profiles = {}

# Compute feature means in original unscaled space for interpretation
for c in range(best_k):
    c_df = df[df['cluster'] == c]
    size = len(c_df)
    pct = round((size / len(df)) * 100, 2)
    
    means = c_df[FEATURE_COLS].mean().to_dict()
    medians = c_df[FEATURE_COLS].median().to_dict()
    
    # Generate human-readable profile based on dominant features
    name = f"Cluster {c}"
    desc = "Standard purchasing behavior pattern."
    traits = []

    m_spend = means['monthly_spend']
    p_count = means['purchase_count']
    elec = means['electronics_spend']
    fash = means['fashion_spend']
    food = means['food_spend']
    home = means['home_spend']
    online = means['online_purchase_ratio']

    if m_spend > 60000 and elec > 0.35:
        name = "High-Value Electronics Enthusiast"
        desc = "Substantial monthly spend heavily concentrated in high-end electronics, gadgets, and tech hardware."
        traits = ["High Average Order Value", "Tech & Electronics Focus", "High Online Preference"]
    elif food > 0.40 and p_count >= 20:
        name = "Frequent Household & Grocery Spender"
        desc = "High transaction volume focused on regular food, groceries, daily essentials, and household items."
        traits = ["High Purchase Frequency", "Grocery & Everyday Essentials", "Moderate Ticket Size"]
    elif fash > 0.35 and online > 0.65:
        name = "Frequent Online Fashion & Lifestyle Buyer"
        desc = "Regular purchases driven primarily by fashion, apparel, lifestyle products, and high online order ratio."
        traits = ["Fashion & Lifestyle Centric", "Strong Online Preference", "Consistent Monthly Activity"]
    elif m_spend > 80000:
        name = "Premium VIP Multi-Category Spender"
        desc = "Top-tier purchasing volume spread across premium electronics, luxury items, and multi-category goods."
        traits = ["Top Tier Total Spend", "Multi-Category Diversity", "High Spending Power"]
    elif p_count <= 10 and m_spend < 20000:
        name = "Occasional Low-Frequency Buyer"
        desc = "Selective buyer with low transaction frequency and conservative monthly expenditure."
        traits = ["Low Purchase Frequency", "Budget Conscious", "Selective Purchasing"]
    else:
        name = "Balanced Everyday Retail Shopper"
        desc = "Steady, well-balanced spending distribution across retail categories with moderate purchase frequency."
        traits = ["Balanced Spending", "Moderate Purchase Volume", "Mixed Category Activity"]

    cluster_profiles[str(c)] = {
        "cluster_id": c,
        "name": name,
        "description": desc,
        "characteristics": traits,
        "size": size,
        "percentage": pct,
        "feature_means": {k: round(v, 4) for k, v in means.items()},
        "feature_medians": {k: round(v, 4) for k, v in medians.items()}
    }

    print(f"\nCluster {c}: {name} ({size} users, {pct}%)")
    print(f"  - Monthly Spend: ₹{means['monthly_spend']:,.2f}")
    print(f"  - Purchase Count: {means['purchase_count']:.1f}/mo")
    print(f"  - Online Ratio: {means['online_purchase_ratio']*100:.1f}%")
    print(f"  - Electronics: {elec*100:.1f}%, Fashion: {fash*100:.1f}%, Food: {food*100:.1f}%")

# 6. Save Model & Metadata Artifacts
models_dir = os.path.join(BASE_DIR, "models")
artifacts_dir = os.path.join(BASE_DIR, "artifacts")
os.makedirs(models_dir, exist_ok=True)
os.makedirs(artifacts_dir, exist_ok=True)

# Save Trained Pipeline / Scaler + Model
model_artifact = {
    "scaler": scaler,
    "kmeans": final_kmeans,
    "feature_names": FEATURE_COLS,
    "selected_k": best_k,
    "model_name": "purchase_behavior_kmeans",
    "model_version": "1.0.0",
    "trained_at": datetime.now().isoformat()
}
model_path = os.path.join(models_dir, "purchase_behavior_clustering_model.joblib")
joblib.dump(model_artifact, model_path)
print(f"\n💾 Saved trained model artifact to: {model_path}")

# Save Metrics JSON
metrics_path = os.path.join(artifacts_dir, "clustering_metrics.json")
with open(metrics_path, "w", encoding="utf-8") as f:
    json.dump({
        "selected_k": best_k,
        "best_silhouette_score": round(best_score, 4),
        "k_evaluation": metrics
    }, f, indent=2)
print(f"💾 Saved clustering metrics to: {metrics_path}")

# Save Metadata JSON
metadata_path = os.path.join(artifacts_dir, "clustering_metadata.json")
with open(metadata_path, "w", encoding="utf-8") as f:
    json.dump({
        "modelName": "purchase_behavior_kmeans",
        "modelVersion": "1.0.0",
        "algorithm": "KMeans",
        "scaler": "StandardScaler",
        "randomState": 42,
        "selectedK": best_k,
        "featureNames": FEATURE_COLS,
        "datasetRows": len(df),
        "datasetColumns": len(df.columns),
        "datasetPath": csv_path,
        "trainedAt": datetime.now().isoformat()
    }, f, indent=2)
print(f"💾 Saved clustering metadata to: {metadata_path}")

# Save Cluster Profiles JSON
profiles_path = os.path.join(artifacts_dir, "cluster_profiles.json")
with open(profiles_path, "w", encoding="utf-8") as f:
    json.dump(cluster_profiles, f, indent=2)
print(f"💾 Saved cluster profiles to: {profiles_path}")

print(f"\n====================================================")
print(f"✨ ML-04 K-Means Training Complete!")
print(f"====================================================")
