const AuthService = require('../services/authService');
const { validateRegistration, validateLogin } = require('../middleware/validationMiddleware');
const { requireAuth } = require('../middleware/authMiddleware');

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 24 * 60 * 60 * 1000 // 24 hours
};

/**
 * Handle Auth HTTP API Endpoints
 */
async function handleAuthRoutes(req, res, pathName, method) {
  // 1. REGISTER: POST /api/auth/register
  if (pathName === '/api/auth/register' && method === 'POST') {
    return new Promise((resolve) => {
      validateRegistration(req, res, async () => {
        try {
          const { user, token } = await AuthService.registerUser(req.body);

          res.cookie('vibecode_token', token, COOKIE_OPTIONS);
          res.status(201).json({
            success: true,
            message: 'User account registered successfully.',
            data: { user, token }
          });
        } catch (err) {
          const status = err.statusCode || 500;
          res.status(status).json({
            success: false,
            message: err.message || 'Registration failed.'
          });
        }
        resolve();
      });
    });
  }

  // 2. LOGIN: POST /api/auth/login
  if (pathName === '/api/auth/login' && method === 'POST') {
    return new Promise((resolve) => {
      validateLogin(req, res, async () => {
        try {
          const { user, token } = await AuthService.loginUser(req.body);

          res.cookie('vibecode_token', token, COOKIE_OPTIONS);
          res.status(200).json({
            success: true,
            message: 'Login successful.',
            data: { user, token }
          });
        } catch (err) {
          const status = err.statusCode || 500;
          res.status(status).json({
            success: false,
            message: err.message || 'Login authentication failed.'
          });
        }
        resolve();
      });
    });
  }

  // 3. LOGOUT: POST /api/auth/logout
  if (pathName === '/api/auth/logout' && method === 'POST') {
    res.clearCookie('vibecode_token', COOKIE_OPTIONS);
    return res.status(200).json({
      success: true,
      message: 'Logged out successfully.'
    });
  }

  // 4. CURRENT USER: GET /api/auth/me
  if (pathName === '/api/auth/me' && method === 'GET') {
    return new Promise((resolve) => {
      requireAuth(req, res, async () => {
        try {
          const user = await AuthService.getUserById(req.user.id);
          if (!user) {
            return res.status(404).json({
              success: false,
              message: 'User profile not found.'
            });
          }

          res.status(200).json({
            success: true,
            message: 'Current user profile fetched successfully.',
            data: { user }
          });
        } catch (err) {
          res.status(500).json({
            success: false,
            message: 'Failed to retrieve current user session.'
          });
        }
        resolve();
      });
    });
  }

  // 5. UPDATE PROFILE: PUT /api/auth/profile
  if (pathName === '/api/auth/profile' && method === 'PUT') {
    return new Promise((resolve) => {
      requireAuth(req, res, async () => {
        try {
          const { name, newPassword } = req.body || {};
          const updatedUser = await AuthService.updateUserProfile(req.user.id, { name, newPassword });

          res.status(200).json({
            success: true,
            message: 'Profile updated successfully.',
            data: { user: updatedUser }
          });
        } catch (err) {
          const status = err.statusCode || 500;
          res.status(status).json({
            success: false,
            message: err.message || 'Failed to update profile.'
          });
        }
        resolve();
      });
    });
  }

  return false; // Route not matched
}

module.exports = { handleAuthRoutes, COOKIE_OPTIONS };
