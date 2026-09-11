# 🛡️ SmartPurchaseAI — AI Purchase & Warranty Intelligence System

> **SmartPurchaseAI** is an enterprise-grade AI financial and warranty management platform. It combines multimodal receipt scanning, automated policy intelligence, RAG-powered interactive purchase copilot, and machine learning models (spending forecasting, category classification, anomaly detection, customer behavior clustering) to help users protect their consumer rights, meet return deadlines, and track total asset protection.

---

## 🏗️ System Architecture

```text
                                  +---------------------------------------+
                                  |         SmartPurchaseAI Client        |
                                  | (HTML5 / Vanilla CSS / JavaScript ES6)|
                                  +-------------------+-------------------+
                                                      |
                                      REST APIs / Multipart Uploads
                                                      |
                                                      v
                                  +---------------------------------------+
                                  |         Express REST API Gateway      |
                                  |             (Node.js v18+)            |
                                  |            Port: 5000 (HTTP)          |
                                  +---------+-------------------+---------+
                                            |                   |
                     Mongoose / Compass     |                   | Proxy / HTTP
                                            v                   v
                        +----------------------+     +-----------------------+
                        |   MongoDB Compass    |     |  FastAPI ML & RAG Svc |
                        |  (smart_warranty_db) |     |     (Python 3.10+)    |
                        |      Port: 27017     |     |    Port: 8000 (HTTP)  |
                        +----------------------+     +-----------+-----------+
                                                                 |
                                             Gemini API / Vector | Embeddings
                                                                 v
                                                     +-----------------------+
                                                     | Google Gemini 2.5/1.5 |
                                                     |  & TF-IDF / BM25 RAG  |
                                                     +-----------------------+
```

---

## 📁 Repository Structure

```text
VibeCode-main/
├── README.md                           # Master Project Documentation & Architecture
├── ML_01_category_classification.csv   # Training dataset for Product Category NLP Model
├── ML_02_spending_forecasting.csv      # Training dataset for Spending Time-Series Model
├── ML_03_spending_anomaly_detection.csv# Training dataset for Anomaly Detection Model
├── ML_04_purchase_behavior_clustering.csv # Training dataset for Behavioral Clustering Model
│
└── VibeCode-main/VibeCode/
    ├── README.md                       # Project Documentation
    │
    ├── Frontend/                       # Responsive Vanilla Web Client (Glassmorphic Dark/Light)
    │   ├── index.html                  # Consumer Login & Registration Portal
    │   ├── dashboard.html              # Main Intelligence Dashboard & Deadlines Center
    │   ├── products.html               # Purchases & Warranty Vault (Filter, Search, Detail View)
    │   ├── claims.html                 # Warranty Claims & Disputes Tracker
    │   ├── documents.html              # Digital Invoices & Receipt Vault
    │   ├── notifications.html          # Notification & Deadline Alert Center
    │   ├── profile.html                # User Profile & Preferences
    │   ├── contact.html                # Consumer Rights & Support Hub
    │   ├── 404.html                    # Fallback Error View
    │   │
    │   ├── js/
    │   │   ├── api.js                  # Centralized REST API Client
    │   │   ├── toast.js                # Non-intrusive Toast Notification System
    │   │   ├── route-guard.js          # Authentication Guard & Dynamic Profile Sync
    │   │   └── components/
    │   │       ├── chatbot.js          # RAG Copilot Chat Widget with Multi-turn History
    │   │       └── ui-helpers.js       # Modal, Loader & Skeleton Component Helpers
    │   │
    │   ├── auth.css / auth.js          # Authentication Portal Styling & Handlers
    │   ├── dashboard.css / dashboard.js# Dashboard Grid, Chart.js Visualizers & OCR Handlers
    │   ├── product.css / product.js    # Vault Filter Engine, Modal Logic & Claim Letter Generator
    │   ├── claims.css / claims.js      # Claims Management & Export Logic
    │   └── notifications.css / notifications.js # Alert Filtering & Read State Management
    │
    ├── backend/                        # Node.js + Express REST API Backend
    │   ├── config/
    │   │   └── db.js                   # Mongoose Connection Manager for MongoDB Compass
    │   ├── models/
    │   │   ├── User.js                 # User Identity & Security Schema
    │   │   ├── Purchase.js             # Purchase, Warranty & Policy Schema
    │   │   ├── Claim.js                # Warranty Dispute & Claim Schema
    │   │   ├── Document.js             # Document & Receipt Storage Schema
    │   │   └── Notification.js         # Deadline & Expiry Alert Schema
    │   ├── routes/
    │   │   ├── authRoutes.js           # Authentication Endpoints (/api/auth)
    │   │   ├── purchaseRoutes.js       # Purchase Management & Deadlines (/api/purchases)
    │   │   ├── claimRoutes.js          # Claim Operations (/api/claims)
    │   │   ├── documentRoutes.js       # Document Vault Operations (/api/documents)
    │   │   ├── notificationRoutes.js   # Notification Operations (/api/notifications)
    │   │   └── copilotRoutes.js        # RAG Copilot Query Endpoint (/api/copilot)
    │   ├── services/
    │   │   ├── authService.js          # Salted PBKDF2 Password Hashing & JWT Verification
    │   │   ├── purchaseService.js      # Purchases CRUD, Spend Analytics, Deadline Engine
    │   │   ├── aiReceiptParser.js      # Multimodal OCR & Merchant Policy Engine
    │   │   ├── aiClaimService.js       # AI Warranty Claim & Dispute Letter Generator
    │   │   └── copilotService.js       # RAG Vector Search & Gemini Integration Bridge
    │   ├── uploads/receipts/           # Saved Digital Receipts & Uploaded Invoices
    │   ├── server.js                   # Express Application Entry Point
    │   ├── package.json                # Node.js Dependencies
    │   └── .env                        # Backend Environment Variables
    │
    └── ml-service/                     # Python / FastAPI Microservice
        ├── main.py                     # FastAPI Application Entry Point (Port 8000)
        ├── rag_engine.py               # RAG Vector Search & Gemini Copilot Engine
        ├── ml_service_01.py            # ML-01: Product Category NLP Classifier
        ├── ml_service_02.py            # ML-02: Spending Forecasting & Budget Regressor
        ├── ml_service_03.py            # ML-03: Spending Anomaly Detection (Isolation Forest)
        ├── ml_service_04.py            # ML-04: Purchase Behavior Clustering (K-Means)
        ├── voice_service.py            # Speech-to-Text & Text-to-Speech Engine
        ├── translation_service.py      # Multi-Language Translation Service
        ├── requirements.txt            # Python Dependencies
        └── .env                        # ML Microservice Environment Variables
```

---

## ⚡ Core Features & Intelligence Capabilities

### 1. 🤖 RAG-Powered Financial & Warranty Copilot
- **Retrieval-Augmented Generation (RAG):** Combines local TF-IDF / BM25 indexed retrieval from the user's live purchase database with Google Gemini LLM synthesis.
- **Context-Aware Answers:** Accurately calculates remaining return window days, active warranty periods, eligible dispute clauses, and cumulative spend.
- **Persistent Chat History:** Seamlessly stores and restores conversation history across browser refreshes.

### 2. 🧾 Smart AI Receipt & Bill Scanner
- **Dual-Engine OCR:** Extracts merchant names, product titles, purchase dates, total prices, currencies, serial numbers, and invoice numbers.
- **Automated Policy Resolution:** Instantly estimates default return periods (e.g. 15–30 days) and manufacturer warranty lengths (12–24 months) based on merchant and product category.

### 3. 📊 Predictive Machine Learning Suite
- **ML-01 (Category Classification):** Automatically tags uncategorized purchases into standardized departments (Electronics, Fashion, Home Appliances, Gadgets, Furniture, Groceries).
- **ML-02 (Spending Forecasting):** Projects future 30/60/90-day spending trends based on historical purchase frequency and volume.
- **ML-03 (Anomaly Detection):** Flags irregular transactions and abnormal pricing outliers via Isolation Forest algorithms.
- **ML-04 (Behavioral Clustering):** Segments purchasing behavior to identify budget efficiency and recurring purchase patterns.

### 4. ⚖️ 1-Click AI Warranty Claim & Dispute Letter Generator
- Dynamically compiles formal, legally-structured warranty claim letters adhering to consumer protection standards.
- Injects exact serial numbers, invoice dates, purchase locations, and merchant return policies for one-click submission or PDF export.

---

## 🛠️ Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | HTML5, Modern Vanilla CSS3 (Custom Design System, Glassmorphism), Vanilla ES6+ JavaScript, Chart.js |
| **Backend** | Node.js, Express.js, Mongoose ODM, Multer, PBKDF2 Crypto, JSONWebToken (JWT), Cookie-Parser, CORS |
| **ML & AI Service** | Python 3.10+, FastAPI, Uvicorn, Scikit-Learn, Pandas, NumPy, Google Generative AI (Gemini) |
| **Database** | MongoDB Compass / MongoDB Local / MongoDB Atlas (`smart_warranty_db`) |
| **OCR & NLP** | Tesseract.js / Google Gemini Multimodal Vision API, TF-IDF / BM25 Vector Indexing |

---

## 🚀 Installation & Setup Guide

### 1. Prerequisites
- **Node.js** (v18.0.0 or higher)
- **Python** (v3.10 or higher)
- **MongoDB** running locally at `mongodb://localhost:27017` (or MongoDB Atlas URI)

---

### 2. Backend Setup
```bash
# Navigate to backend directory
cd VibeCode-main/VibeCode/backend

# Install dependencies
npm install

# Start Express server
node server.js
```
The backend server runs at **`http://localhost:5000`**.

#### Backend `.env` Configuration
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/smart_warranty_db
JWT_SECRET=smart_purchase_ai_secure_jwt_secret_2026
NODE_ENV=development
ML_SERVICE_URL=http://127.0.0.1:8000
GEMINI_API_KEY=your_gemini_api_key_here
```

---

### 3. Machine Learning & RAG Service Setup
```bash
# Navigate to ML service directory
cd VibeCode-main/VibeCode/ml-service

# Create and activate Python virtual environment
python -m venv .venv
# On Windows:
.venv\Scripts\activate
# On macOS/Linux:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start FastAPI server
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```
The ML microservice runs at **`http://127.0.0.1:8000`** with interactive OpenAPI documentation at **`http://127.0.0.1:8000/docs`**.

#### ML Service `.env` Configuration
```env
PORT=8000
HOST=127.0.0.1
GEMINI_API_KEY=your_gemini_api_key_here
BACKEND_API_URL=http://localhost:5000/api
```

---

### 4. Running the Application
Open your web browser and navigate to:
👉 **`http://localhost:5000`**

- **Sign Up / Sign In:** Register any consumer account to create a live profile in MongoDB.
- **Purchases & Vault:** Browse 16+ preloaded realistic purchase documents across 6 categories.
- **RAG Copilot:** Click the **Copilot** widget in the bottom-right corner to ask questions about your warranty terms, return deadlines, or spending statistics.

---

## 📡 Key REST API Reference

### 🔐 Authentication (`/api/auth`)
- `POST /api/auth/register` — Register a new consumer user account in MongoDB.
- `POST /api/auth/login` — Authenticate credentials & issue JWT session token.
- `POST /api/auth/logout` — Clear session cookies and invalidate local session.
- `GET /api/auth/me` — Retrieve the authenticated user's profile and settings.

### 📦 Purchases & Vault (`/api/purchases`)
- `GET /api/purchases` — List user purchases with full text search, category filter, and sorting.
- `POST /api/purchases` — Add a new purchase record manually or via OCR scan.
- `GET /api/purchases/:id` — Retrieve comprehensive details for a specific item.
- `PUT /api/purchases/:id` — Modify purchase metadata, warranty length, or return date.
- `DELETE /api/purchases/:id` — Remove an item from the vault.
- `GET /api/purchases/analytics/stats` — Calculate active warranty protection and spending breakdown.
- `GET /api/purchases/alerts/deadlines` — Query return deadlines (<7 days) and warranty expirations (<30 days).
- `POST /api/purchases/:id/claim-letter` — Generate formal AI warranty claim dispute letter.

### 🤖 RAG & Intelligence (`/api/copilot`)
- `POST /api/copilot/chat` — Send query to RAG Copilot with user context injection.
- `GET /api/copilot/index-status` — Check RAG vector store indexing status.

---

## 🔒 Security & Privacy Standards
- **Salted Password Hashing:** PBKDF2 with 10,000 iterations and unique cryptographic salts.
- **Scoped User Isolation:** All database queries are strictly isolated to the authenticated `userId`.
- **JWT Session Security:** Token validation with HS256 encryption.
- **Secure File Storage:** Uploaded receipts are validated by MIME type, sanitized, and stored with unique identifiers.
