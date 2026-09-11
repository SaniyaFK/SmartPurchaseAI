/**
 * Node.js Client Service for Python ML-01 + ML-02 Microservice.
 * Communicates with FastAPI endpoints (http://127.0.0.1:8000).
 * Provides silent error handling and offline fallback so Node.js backend never crashes.
 */

'use strict';

const http = require('http');

class MlService {
  /**
   * Get target ML service base URL from environment (default: http://127.0.0.1:8000)
   */
  static getMlServiceUrl() {
    return process.env.ML_SERVICE_URL || 'http://127.0.0.1:8000';
  }

  /**
   * Get operational confidence threshold for category predictions (default: 0.70, configurable)
   */
  static getMinConfidenceThreshold() {
    const rawVal = parseFloat(process.env.ML_CATEGORY_MIN_CONFIDENCE);
    return !isNaN(rawVal) ? rawVal : 0.70;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ML-01: Category Prediction
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Request category prediction from Python FastAPI ML service (ML-01).
   * @param {object} purchaseData - Extracted purchase details
   * @returns {Promise<object|null>} - Returns prediction object or null if unavailable/low confidence
   */
  static async predictCategory(purchaseData) {
    if (!purchaseData) return null;

    const payload = {
      product_name: purchaseData.productName || purchaseData.product_name || '',
      brand: purchaseData.brand || '',
      merchant: purchaseData.storeName || purchaseData.merchant || '',
      description: purchaseData.rawOcrText || purchaseData.notes || purchaseData.description || '',
      purchase_type: purchaseData.purchaseType || purchaseData.purchase_type || '',
      amount: purchaseData.amount || purchaseData.price || null
    };

    // Require at least product name, brand, or merchant to attempt ML query
    if (!payload.product_name && !payload.brand && !payload.merchant) {
      return null;
    }

    const baseUrl = this.getMlServiceUrl();
    const minConfidence = this.getMinConfidenceThreshold();

    try {
      const url = new URL('/predict/category', baseUrl);
      const postData = JSON.stringify(payload);
      const response = await this._httpPostJson(url, postData, 2500);

      if (!response || !response.success || !response.predictedCategory) {
        return null;
      }

      return {
        predictedCategory: response.predictedCategory,
        confidence: response.confidence || 0,
        modelName: response.modelName || 'category_tfidf_logistic_regression',
        modelVersion: response.modelVersion || '1.0.0',
        topPredictions: response.topPredictions || [],
        isAboveThreshold: (response.confidence || 0) >= minConfidence
      };
    } catch (err) {
      console.warn(`[MlService] Category prediction notice: ${err.message} (Fallback active)`);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ML-02: Spending Forecasting
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Request next-month spending prediction from Python FastAPI ML service (ML-02).
   *
   * Features MUST be computed using the same time windows as train_spending_model.py:
   *   - previous_month_spend  : total spend in month M-1 (most recent complete month)
   *   - spend_2_months_ago    : total spend in month M-2
   *   - spend_3_months_ago    : total spend in month M-3
   *   - avg_3_month_spend     : mean(M-1, M-2, M-3)
   *   - purchase_count        : count of all purchases in M-1
   *   - avg_purchase_amount   : previous_month_spend / purchase_count (0 if none)
   *   - online_purchase_ratio : fraction of M-1 purchases with purchaseType == 'ONLINE'
   *   - electronics_spend     : M-1 spend where category == 'Electronics'
   *   - fashion_spend         : M-1 spend where category == 'Fashion'
   *   - food_spend            : M-1 spend where category in ['Food & Beverages', 'Food & Groceries']
   *   - home_spend            : M-1 spend where category in ['Home Appliances', 'Furniture']
   *   - other_spend           : M-1 spend in all remaining categories
   *
   * @param {object} features - 12 spending features matching definitions above
   * @returns {Promise<object|null>} - { predictedNextMonthSpend, modelName, modelVersion } or null
   */
  static async predictNextMonthSpending(features) {
    if (!features) return null;

    const requiredKeys = [
      'previous_month_spend', 'spend_2_months_ago', 'spend_3_months_ago',
      'avg_3_month_spend', 'purchase_count', 'avg_purchase_amount',
      'online_purchase_ratio', 'electronics_spend', 'fashion_spend',
      'food_spend', 'home_spend', 'other_spend'
    ];

    // Validate all required features are present and numeric
    for (const key of requiredKeys) {
      const val = features[key];
      if (val === undefined || val === null || (typeof val === 'number' && isNaN(val))) {
        console.warn(`[MlService] Missing or invalid feature '${key}' — spending prediction skipped.`);
        return null;
      }
    }

    const baseUrl = this.getMlServiceUrl();

    try {
      const url = new URL('/predict/spending', baseUrl);
      const postData = JSON.stringify(features);
      const response = await this._httpPostJson(url, postData, 3000);

      if (!response || !response.success || response.predictedNextMonthSpend === undefined) {
        return null;
      }

      return {
        predictedNextMonthSpend: response.predictedNextMonthSpend,
        modelName: response.modelName || 'SpendingForecaster',
        modelVersion: response.modelVersion || 'ml-02-v1',
        isMLPrediction: true
      };
    } catch (err) {
      console.warn(`[MlService] Spending prediction notice: ${err.message} (Fallback active)`);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ML-03: Spending Anomaly Detection
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Request spending anomaly detection from Python FastAPI ML service (ML-03).
   *
   * Features required (7 numerical features):
   *   - purchase_amount                   : float
   *   - user_monthly_spend                : float
   *   - category_average_purchase         : float
   *   - purchase_count_last_30_days       : int
   *   - days_since_last_purchase          : int
   *   - amount_to_monthly_spend_ratio     : float
   *   - amount_to_category_average_ratio  : float
   *
   * @param {object} features - 7 numerical features matching definitions above
   * @returns {Promise<object|null>} - { isAnomaly, anomalyScore, modelName, modelVersion } or null (offline fallback)
   */
  static async detectSpendingAnomaly(features) {
    if (!features) return null;

    const requiredKeys = [
      'purchase_amount', 'user_monthly_spend', 'category_average_purchase',
      'purchase_count_last_30_days', 'days_since_last_purchase',
      'amount_to_monthly_spend_ratio', 'amount_to_category_average_ratio'
    ];

    for (const key of requiredKeys) {
      const val = features[key];
      if (val === undefined || val === null || (typeof val === 'number' && isNaN(val))) {
        console.warn(`[MlService] Missing or invalid feature '${key}' — anomaly detection skipped.`);
        return null;
      }
    }

    const baseUrl = this.getMlServiceUrl();

    try {
      const url = new URL('/predict/anomaly', baseUrl);
      const postData = JSON.stringify(features);
      const response = await this._httpPostJson(url, postData, 2500);

      if (!response || !response.success || response.isAnomaly === undefined) {
        return null;
      }

      return {
        isAnomaly: response.isAnomaly,
        anomalyScore: response.anomalyScore,
        modelName: response.modelName || 'IsolationForest',
        modelVersion: response.modelVersion || 'ml-03-v1'
      };
    } catch (err) {
      console.warn(`[MlService] Anomaly detection notice: ${err.message} (Offline fallback active)`);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ML-04: Purchase Behavior Clustering
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Request purchase behavior cluster prediction from Python FastAPI ML service (ML-04).
   *
   * Features (10 behavioral metrics — must match training feature definitions):
   *   - purchase_count              : monthly purchase transaction count
   *   - monthly_spend               : total monthly spend amount
   *   - avg_purchase_amount         : average spend per transaction
   *   - online_purchase_ratio       : fraction of online purchases (0–1)
   *   - electronics_spend           : electronics category spend ratio (0–1)
   *   - fashion_spend               : fashion category spend ratio (0–1)
   *   - food_spend                  : food & groceries spend ratio (0–1)
   *   - home_spend                  : home appliances spend ratio (0–1)
   *   - other_spend                 : other categories spend ratio (0–1)
   *   - avg_days_between_purchases  : average days between consecutive purchases
   *
   * @param {object} features - 10 behavioral features matching the model's training schema
   * @returns {Promise<object|null>} - { cluster, clusterName, description, characteristics, modelName, modelVersion } or null
   */
  static async predictPurchaseBehavior(features) {
    if (!features) return null;

    const requiredKeys = [
      'purchase_count', 'monthly_spend', 'avg_purchase_amount',
      'online_purchase_ratio', 'electronics_spend', 'fashion_spend',
      'food_spend', 'home_spend', 'other_spend', 'avg_days_between_purchases'
    ];

    for (const key of requiredKeys) {
      const val = features[key];
      if (val === undefined || val === null || (typeof val === 'number' && isNaN(val))) {
        console.warn(`[MlService] Missing or invalid feature '${key}' — behavior prediction skipped.`);
        return null;
      }
    }

    const baseUrl = this.getMlServiceUrl();

    try {
      const url = new URL('/predict/behavior', baseUrl);
      const postData = JSON.stringify(features);
      const response = await this._httpPostJson(url, postData, 3000);

      if (!response || !response.success || response.cluster === undefined) {
        return null;
      }

      return {
        cluster: response.cluster,
        clusterName: response.clusterName || `Cluster ${response.cluster}`,
        description: response.description || '',
        characteristics: response.characteristics || [],
        clusterSize: response.clusterSize || 0,
        clusterPercentage: response.clusterPercentage || 0,
        modelName: response.modelName || 'purchase_behavior_kmeans',
        modelVersion: response.modelVersion || '1.0.0',
        isMLPrediction: true
      };
    } catch (err) {
      console.warn(`[MlService] Behavior prediction notice: ${err.message} (Offline fallback active)`);
      return null;
    }
  }



  // ─────────────────────────────────────────────────────────────────────────
  // Internal HTTP helper
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Internal HTTP POST helper using built-in Node.js http module with timeout.
   * @private
   */
  static _httpPostJson(urlObj, postData, timeoutMs = 2500) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: urlObj.hostname,
          port: urlObj.port || 8000,
          path: urlObj.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          },
          timeout: timeoutMs
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                reject(new Error('Invalid JSON response from ML service'));
              }
            } else {
              reject(new Error(`ML service HTTP ${res.statusCode}`));
            }
          });
        }
      );

      req.on('error', (err) => { reject(err); });
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('ML service connection timeout'));
      });

      req.write(postData);
      req.end();
    });
  }
}

module.exports = MlService;
