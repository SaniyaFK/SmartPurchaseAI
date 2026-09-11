"""
ML-01 Category Model Training Script.
Trains a scikit-learn Pipeline (TF-IDF Vectorizer + Logistic Regression) on ML_01_category_classification.csv.
Saves model to models/category_classifier.joblib, metrics to models/category_metrics.json,
and confusion matrix to models/category_confusion_matrix.json.
"""

import os
import sys
import json
import pandas as pd
import numpy as np
import joblib

from sklearn.model_selection import train_test_split
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    classification_report,
    confusion_matrix
)

# Add parent directory to sys.path to allow importing preprocessing module
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from preprocessing.text_preprocessor import create_combined_text_feature

def train_model():
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    data_path = os.path.join(base_dir, 'data', 'ML_01_category_classification.csv')
    
    # Search parent directories for ML_01_category_classification.csv if not in ml-service/data/
    if not os.path.exists(data_path):
        current_dir = base_dir
        found = False
        for _ in range(5):
            candidate = os.path.join(current_dir, 'ML_01_category_classification.csv')
            if os.path.exists(candidate):
                data_path = candidate
                found = True
                break
            candidate_data = os.path.join(current_dir, 'data', 'ML_01_category_classification.csv')
            if os.path.exists(candidate_data):
                data_path = candidate_data
                found = True
                break
            parent = os.path.dirname(current_dir)
            if parent == current_dir:
                break
            current_dir = parent

        if not found:
            raise FileNotFoundError(f"Dataset ML_01_category_classification.csv not found starting from {base_dir}")


    print(f"====================================================")
    print(f"📊 ML-01 Category Classification Model Training")
    print(f"📂 Dataset path: {data_path}")
    print(f"====================================================")

    df = pd.read_csv(data_path)
    print(f"Total dataset rows: {len(df)}")
    
    # Category Distribution Check (Ensuring no silent label merging)
    category_counts = df['category'].value_counts().to_dict()
    print("\n--- Category Distribution ---")
    for cat, count in category_counts.items():
        print(f"  • {cat}: {count} samples")
    print("----------------------------------------------------\n")

    # Feature Engineering: Combine textual features
    df['text_feature'] = df.apply(create_combined_text_feature, axis=1)
    
    X = df['text_feature']
    y = df['category']

    # Stratified Train/Test Split (80% train, 20% test)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, random_state=42, stratify=y
    )

    print(f"Training samples: {len(X_train)} | Testing samples: {len(X_test)}")
    print(f"Number of classes: {len(y.unique())}")

    # Build Pipeline: TF-IDF + Logistic Regression
    pipeline = Pipeline([
        ('tfidf', TfidfVectorizer(
            ngram_range=(1, 2),
            min_df=1,
            sublinear_tf=True
        )),
        ('clf', LogisticRegression(
            C=1.5,
            max_iter=1000,
            solver='lbfgs',
            random_state=42
        ))
    ])

    print("\nTraining TF-IDF + Logistic Regression pipeline...")
    pipeline.fit(X_train, y_train)
    print("Model training completed successfully.")

    # Model Evaluation
    y_pred = pipeline.predict(X_test)
    acc = float(accuracy_score(y_test, y_pred))
    prec_macro = float(precision_score(y_test, y_pred, average='macro'))
    prec_weighted = float(precision_score(y_test, y_pred, average='weighted'))
    rec_macro = float(recall_score(y_test, y_pred, average='macro'))
    rec_weighted = float(recall_score(y_test, y_pred, average='weighted'))
    f1_mac = float(f1_score(y_test, y_pred, average='macro'))
    f1_wei = float(f1_score(y_test, y_pred, average='weighted'))

    print("\n--- Model Evaluation Results ---")
    print(f"Accuracy:           {acc:.4f} ({acc*100:.2f}%)")
    print(f"Precision (Macro):   {prec_macro:.4f}")
    print(f"Precision (Weighted):{prec_weighted:.4f}")
    print(f"Recall (Macro):      {rec_macro:.4f}")
    print(f"Recall (Weighted):   {rec_weighted:.4f}")
    print(f"F1 Score (Macro):    {f1_mac:.4f}")
    print(f"F1 Score (Weighted): {f1_wei:.4f}")
    print("----------------------------------------------------")

    # Classification Report
    cls_report = classification_report(y_test, y_pred, output_dict=True)

    # Confusion Matrix
    unique_labels = sorted(list(y.unique()))
    cm = confusion_matrix(y_test, y_pred, labels=unique_labels)
    cm_dict = {
        "labels": unique_labels,
        "matrix": cm.tolist()
    }

    # Ensure output models directory exists
    models_dir = os.path.join(base_dir, 'models')
    os.makedirs(models_dir, exist_ok=True)

    # Metrics JSON
    metrics_data = {
        "algorithm": "TF-IDF Vectorizer + Logistic Regression",
        "training_samples": len(X_train),
        "testing_samples": len(X_test),
        "num_classes": len(unique_labels),
        "classes": unique_labels,
        "accuracy": round(acc, 4),
        "precision_macro": round(prec_macro, 4),
        "precision_weighted": round(prec_weighted, 4),
        "recall_macro": round(rec_macro, 4),
        "recall_weighted": round(rec_weighted, 4),
        "f1_macro": round(f1_mac, 4),
        "f1_weighted": round(f1_wei, 4),
        "classification_report": cls_report
    }

    metrics_path = os.path.join(models_dir, 'category_metrics.json')
    with open(metrics_path, 'w', encoding='utf-8') as f:
        json.dump(metrics_data, f, indent=2)
    print(f"✅ Saved metrics to: {metrics_path}")

    # Confusion Matrix JSON
    cm_path = os.path.join(models_dir, 'category_confusion_matrix.json')
    with open(cm_path, 'w', encoding='utf-8') as f:
        json.dump(cm_dict, f, indent=2)
    print(f"✅ Saved confusion matrix to: {cm_path}")

    # Save Pipeline via Joblib
    model_path = os.path.join(models_dir, 'category_classifier.joblib')
    joblib.dump(pipeline, model_path)
    print(f"✅ Saved model pipeline to: {model_path}")
    print("====================================================")

    return metrics_data

if __name__ == '__main__':
    train_model()
