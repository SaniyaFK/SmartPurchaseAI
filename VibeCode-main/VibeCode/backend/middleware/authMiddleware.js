const AuthService = require('../services/authService');

/**
 * Extract token from cookies or Authorization header
 */
function extractToken(req) {
  // Check HTTP-only cookie first
  if (req.cookies && req.cookies.vibecode_token) {
    return req.cookies.vibecode_token;
  }

  // Fallback to Bearer token header
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.split(' ')[1];
  }

  return null;
}

/**
 * Middleware: Require authenticated user
 */
function requireAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please log in to access this resource.'
      });
    }

    const decoded = AuthService.verifyTokenPayload(token);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: err.message || 'Session expired or invalid token. Please log in again.'
    });
  }
}

/**
 * Middleware: Require specific user role (e.g. requireRole('admin'))
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Requires one of the following roles: ${allowedRoles.join(', ')}.`
      });
    }

    next();
  };
}

module.exports = {
  requireAuth,
  requireRole,
  extractToken
};
