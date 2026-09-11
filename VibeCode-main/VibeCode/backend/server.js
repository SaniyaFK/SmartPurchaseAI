const http = require('http');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { connectDB, getDbStatus } = require('./config/db');
const { handleAuthRoutes } = require('./routes/authRoutes');
const { handlePurchaseRoutes } = require('./routes/purchaseRoutes');
const { handleNotificationRoutes } = require('./routes/notificationRoutes');
const { handleClaimRoutes } = require('./routes/claimRoutes');
const { handleCopilotRoutes } = require('./routes/copilotRoutes');
const { handleDocumentRoutes } = require('./routes/documentRoutes');
const { handleRagRoutes } = require('./routes/ragRoutes');

// Load .env configuration (MONGODB_URI, JWT_SECRET, NODE_ENV, PORT)
const envPath = path.join(__dirname, '.env');
require('dotenv').config({ path: envPath });

let PORT = 5000;
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const match = envContent.match(/^PORT=(.*)$/m);
  if (match && match[1]) {
    PORT = parseInt(match[1].trim(), 10) || 5000;
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

/**
 * Cookie Parser Helper
 */
function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader) return list;

  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    const name = parts.shift().trim();
    const val = decodeURIComponent(parts.join('='));
    if (name) list[name] = val;
  });
  return list;
}

/**
 * Static File Server Helper
 */
function serveStaticFile(req, res, pathName) {
  let relativePath = pathName === '/' ? '/index.html' : pathName;
  
  // Handle uploaded files
  if (pathName.startsWith('/uploads/')) {
    const uploadFilePath = path.join(__dirname, pathName);
    if (fs.existsSync(uploadFilePath) && fs.statSync(uploadFilePath).isFile()) {
      const ext = path.extname(uploadFilePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': contentType });
      fs.createReadStream(uploadFilePath).pipe(res);
      return;
    }
  }

  const frontendDir = path.join(__dirname, '..', 'Frontend');
  const filePath = path.normalize(path.join(frontendDir, relativePath));

  // Security check against directory traversal
  if (!filePath.startsWith(frontendDir)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, message: 'Access forbidden.' }));
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    fs.createReadStream(filePath).pipe(res);
  } else {
    // Serve custom 404 page if present
    const custom404 = path.join(frontendDir, '404.html');
    if (fs.existsSync(custom404)) {
      res.writeHead(404, {
        'Content-Type': 'text/html; charset=UTF-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      fs.createReadStream(custom404).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Resource not found.' }));
    }
  }
}

/**
 * Main HTTP Server Request Listener
 */
const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathName = reqUrl.pathname;
  const method = req.method.toUpperCase();

  // Response Helper Methods (available before routing so error paths can use them)
  res.status = function (code) {
    res.statusCode = code;
    return res;
  };

  res.json = function (obj) {
    if (!res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'application/json');
    }
    res.end(JSON.stringify(obj));
    return res;
  };

  res.cookie = function (name, val, options = {}) {
    let cookieStr = `${name}=${encodeURIComponent(val)}`;
    if (options.maxAge) {
      cookieStr += `; Max-Age=${Math.floor(options.maxAge / 1000)}`;
    }
    cookieStr += `; Path=${options.path || '/'}`;
    if (options.httpOnly) cookieStr += `; HttpOnly`;
    if (options.secure) cookieStr += `; Secure`;
    if (options.sameSite) cookieStr += `; SameSite=${options.sameSite}`;

    const existing = res.getHeader('Set-Cookie') || [];
    const setCookies = Array.isArray(existing) ? existing : [existing];
    setCookies.push(cookieStr);
    res.setHeader('Set-Cookie', setCookies.filter(Boolean));
  };

  res.clearCookie = function (name, options = {}) {
    res.cookie(name, '', { ...options, maxAge: 0 });
  };

  // CORS Headers
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-User-Id');

  // Handle Preflight Options Request
  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Convert URLSearchParams to object
  req.query = Object.fromEntries(reqUrl.searchParams);
  req.cookies = parseCookies(req.headers.cookie);

  // Multipart/form-data: parse immediately with in-memory multer (any()) so
  // busboy attaches to the stream *before* it ends. Then route normally.
  const isMultipart = (req.headers['content-type'] || '').startsWith('multipart/form-data');
  if (isMultipart) {
    const multipartParser = multer({ limits: { fileSize: 15 * 1024 * 1024 } }).any();
    multipartParser(req, res, (parseErr) => {
      if (parseErr) {
        console.warn('Multipart parse error:', parseErr.message);
        return res.status(400).json({ success: false, message: parseErr.message || 'Upload parsing failed.' });
      }
      req.body = req.body || {};
      continueRequest(req, res, pathName, method);
    });
    return;
  }

  // Regular JSON body: buffer then route on end
  let body = '';
  req.on('data', (chunk) => {
    body += chunk.toString();
  });

  req.on('end', async () => {
    try {
      req.body = body ? JSON.parse(body) : {};
    } catch (e) {
      req.body = {};
    }
    continueRequest(req, res, pathName, method);
  });
});

/**
 * Shared request continuation: routes the request.
 * Used by both JSON and multipart body paths.
 */
async function continueRequest(req, res, pathName, method) {
  // Route API endpoints
  if (pathName.startsWith('/api/')) {
    if (pathName === '/api/health' && method === 'GET') {
      const dbStatus = getDbStatus();
      return res.status(200).json({
        success: true,
        application: 'WarrantyVault AI — Smart Purchase & Warranty Manager',
        version: '2.0.0-hackathon-winner',
        database: dbStatus,
        timestamp: new Date().toISOString()
      });
    }

    // 1. Auth routes
    const authHandled = await handleAuthRoutes(req, res, pathName, method);
    if (authHandled !== false) {
      return;
    }

    // 2. Purchase & Warranty routes
    const purchaseHandled = await handlePurchaseRoutes(req, res, pathName, method);
    if (purchaseHandled !== false) {
      return;
    }

    // 3. Notification routes
    const notificationHandled = await handleNotificationRoutes(req, res, pathName, method);
    if (notificationHandled !== false) {
      return;
    }

    // 4. AI Warranty Claim routes (Task 6)
    const claimHandled = await handleClaimRoutes(req, res, pathName, method);
    if (claimHandled !== false) {
      return;
    }

    // 5. AI Purchase Copilot routes (Task 7)
    const copilotHandled = await handleCopilotRoutes(req, res, pathName, method);
    if (copilotHandled !== false) {
      return;
    }

    // 6. Documents & Receipts routes (Task 8)
    const documentHandled = await handleDocumentRoutes(req, res, pathName, method);
    if (documentHandled !== false) {
      return;
    }

    // 7. RAG Chatbot routes (/api/chat)
    const ragHandled = await handleRagRoutes(req, res, pathName, method);
    if (ragHandled !== false) {
      return;
    }

    return res.status(404).json({
      success: false,
      message: `API Endpoint ${method} ${pathName} not found.`
    });
  }

  // Serve Frontend Static Files for all non-API routes
  if (method === 'GET' || method === 'HEAD') {
    serveStaticFile(req, res, pathName);
  } else {
    res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }
}

const AuthService = require('./services/authService');
const { loadAllUsersFromDB } = require('./services/ragIndexService');

// Initialize MongoDB & Start Server
async function startServer() {
  await connectDB();
  await AuthService.seedDefaultAdmin();
  // Populate in-memory RAG index from persisted RagDocument collection
  await loadAllUsersFromDB();

  server.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 WarrantyVault AI Server running at: http://localhost:${PORT}`);
    console.log(`🔗 API Health & DB Status: http://localhost:${PORT}/api/health`);
    console.log(`📦 Purchases API: http://localhost:${PORT}/api/purchases`);
    console.log(`====================================================`);
  });
}

startServer();
