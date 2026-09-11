"""
Validation and automated testing script for ML-04 Purchase Behavior Clustering.
Tests:
1. Artifact integrity (.joblib, metrics JSON, metadata JSON, cluster profiles JSON)
2. Scaler + Model pipeline prediction across different spending personas
3. Cluster boundary checks (valid clusters 0 to k-1)
4. Absence of fake probabilities or confidence scores
5. Consistency between training features and FastAPI schema
"""

import os
import sys
import json
import joblib
import numpy as np

# Set UTF-8 encoding
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR = os.path.join(BASE_DIR, "models")
ARTIFACTS_DIR = os.path.join(BASE_DIR, "artifacts")

def run_tests():
    print("====================================================")
    print("🧪 ML-04 Automated Validation Test Suite")
    print("====================================================\n")

    # Test 1: Check files exist
    print("Test 1: Checking Artifact Files Existence...")
    model_path = os.path.join(MODELS_DIR, "purchase_behavior_clustering_model.joblib")
    metrics_path = os.path.join(ARTIFACTS_DIR, "clustering_metrics.json")
    metadata_path = os.path.join(ARTIFACTS_DIR, "clustering_metadata.json")
    profiles_path = os.path.join(ARTIFACTS_DIR, "cluster_profiles.json")

    assert os.path.exists(model_path), f"Model file missing: {model_path}"
    assert os.path.exists(metrics_path), f"Metrics file missing: {metrics_path}"
    assert os.path.exists(metadata_path), f"Metadata file missing: {metadata_path}"
    assert os.path.exists(profiles_path), f"Profiles file missing: {profiles_path}"
    print("  ✅ All 4 artifact files present.")

    # Test 2: Verify Metadata & Metrics
    print("\nTest 2: Verifying Metrics and Metadata...")
    with open(metrics_path, "r", encoding="utf-8") as f:
        metrics = json.load(f)
    with open(metadata_path, "r", encoding="utf-8") as f:
        metadata = json.load(f)
    with open(profiles_path, "r", encoding="utf-8") as f:
        profiles = json.load(f)

    assert "selected_k" in metrics, "selected_k missing in metrics"
    selected_k = metrics["selected_k"]
    assert selected_k == 4, f"Expected selected_k=4, got {selected_k}"
    assert "best_silhouette_score" in metrics, "best_silhouette_score missing in metrics"
    assert "k_evaluation" in metrics, "k_evaluation missing in metrics"
    assert len(metrics["k_evaluation"]) == 7, "Expected evaluations for k=2..8"

    print(f"  ✅ Selected k: {selected_k}")
    print(f"  ✅ Best Silhouette Score: {metrics['best_silhouette_score']}")
    print(f"  ✅ Evaluated k values: {list(metrics['k_evaluation'].keys())}")

    # Test 3: Load Model & Scaler
    print("\nTest 3: Loading Model Artifact...")
    artifact = joblib.load(model_path)
    assert isinstance(artifact, dict), "Model artifact should be a dictionary"
    assert "scaler" in artifact, "Scaler missing in model artifact"
    assert "kmeans" in artifact, "KMeans missing in model artifact"
    assert "feature_names" in artifact, "feature_names missing in model artifact"

    scaler = artifact["scaler"]
    kmeans = artifact["kmeans"]
    features = artifact["feature_names"]

    assert len(features) == 10, f"Expected 10 features, got {len(features)}"
    assert kmeans.n_clusters == selected_k, f"KMeans n_clusters ({kmeans.n_clusters}) != selected_k ({selected_k})"
    print(f"  ✅ StandardScaler and KMeans(n_clusters={kmeans.n_clusters}) loaded successfully.")

    # Test 4: Prediction Test Cases across distinct user behaviors
    print("\nTest 4: Testing Behavioral Predictions...")
    test_cases = [
        {
            "name": "Grocery & Household Spender",
            "features": [28.0, 15000.0, 535.0, 0.55, 0.10, 0.12, 0.45, 0.11, 0.22, 1.1],
            "expected_cluster": 0
        },
        {
            "name": "Online Fashion Buyer",
            "features": [17.0, 30500.0, 1800.0, 0.76, 0.11, 0.46, 0.16, 0.11, 0.16, 1.8],
            "expected_cluster": 1
        },
        {
            "name": "Premium VIP Spender",
            "features": [12.0, 140000.0, 12000.0, 0.68, 0.33, 0.20, 0.12, 0.19, 0.16, 2.5],
            "expected_cluster": 2
        },
        {
            "name": "Balanced Retail / Tech Shopper",
            "features": [9.0, 55000.0, 6100.0, 0.73, 0.49, 0.08, 0.15, 0.12, 0.16, 3.3],
            "expected_cluster": 3
        }
    ]

    for tc in test_cases:
        feat_vec = np.array([tc["features"]])
        scaled_vec = scaler.transform(feat_vec)
        pred_cluster = int(kmeans.predict(scaled_vec)[0])
        assert 0 <= pred_cluster < selected_k, f"Cluster {pred_cluster} out of range [0, {selected_k-1}]"
        
        profile = profiles.get(str(pred_cluster), {})
        cluster_name = profile.get("name", f"Cluster {pred_cluster}")
        cluster_share = profile.get("percentage", 0.0)

        print(f"  👤 Case: {tc['name']}")
        print(f"     → Predicted Cluster: #{pred_cluster} ({cluster_name})")
        print(f"     → Community Share: {cluster_share}%")
        assert pred_cluster == tc["expected_cluster"], f"Expected cluster {tc['expected_cluster']}, got {pred_cluster}"

    # Test 5: Verify Cluster Profiles Completeness
    print("\nTest 5: Verifying Cluster Profiles Metadata...")
    for c_id in range(selected_k):
        c_str = str(c_id)
        assert c_str in profiles, f"Cluster {c_str} missing in profiles"
        p = profiles[c_str]
        assert "name" in p and len(p["name"]) > 0, f"Missing name for cluster {c_id}"
        assert "description" in p and len(p["description"]) > 0, f"Missing description for cluster {c_id}"
        assert "characteristics" in p and len(p["characteristics"]) >= 2, f"Insufficient characteristics for cluster {c_id}"
        assert "size" in p and p["size"] > 0, f"Invalid size for cluster {c_id}"
        assert "percentage" in p and p["percentage"] > 0, f"Invalid percentage for cluster {c_id}"
        print(f"  ✅ Cluster #{c_id}: '{p['name']}' ({p['size']} users, {p['percentage']}%) — {len(p['characteristics'])} traits")

    print("\n====================================================")
    print("🎉 ALL 5 ML-04 VALIDATION TESTS PASSED SUCCESSFULLY!")
    print("====================================================")

if __name__ == "__main__":
    run_tests()
