const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const User = require('../models/User');

// Load environment variables from backend/.env if available
const envPath = path.join(__dirname, '..', '.env');
let JWT_SECRET = 'vibecode_hackathon_super_secret_jwt_key_2026_smart_warranty';
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const match = envContent.match(/^JWT_SECRET=(.*)$/m);
  if (match && match[1]) {
    JWT_SECRET = match[1].trim();
  }
}

// In-memory fallback map if DB is temporarily disconnected
const inMemoryUsers = new Map();

// Base64Url encoding/decoding for JWT
function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Hash password securely using Node's crypto PBKDF2
 */
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

/**
 * Verify password against stored hash & salt
 */
function verifyPassword(password, storedHash, salt) {
  const { hash } = hashPassword(password, salt);
  return hash === storedHash;
}

/**
 * Generate a JWT token signed with HMAC-SHA256
 */
function generateToken(payload, expiresInSeconds = 86400 * 7) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Verify and decode JWT token
 */
function verifyToken(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('Token missing or invalid');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed token structure');
  }

  const [encodedHeader, encodedPayload, signature] = parts;

  const expectedSignature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  if (signature !== expectedSignature) {
    throw new Error('Invalid token signature');
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload));
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw new Error('Token has expired');
  }

  return payload;
}

class AuthService {
  /**
   * Seed default Admin user directly into MongoDB Compass / database
   */
  static async seedDefaultAdmin() {
    const adminEmail = 'admin@vibecode.com';
    const defaultSalt = 'vibecode_admin_salt';
    const defaultHash = crypto.pbkdf2Sync('Admin123!', defaultSalt, 10000, 64, 'sha512').toString('hex');

    // Always seed in-memory
    inMemoryUsers.set(adminEmail, {
      id: 'usr_admin_001',
      _id: 'usr_admin_001',
      name: 'System Admin',
      email: adminEmail,
      dob: '2000-01-01',
      role: 'admin',
      passwordHash: defaultHash,
      salt: defaultSalt,
      createdAt: new Date().toISOString()
    });

    // Seed into MongoDB Compass
    if (mongoose.connection.readyState === 1) {
      try {
        const existingAdmin = await User.findOne({ email: adminEmail });
        if (!existingAdmin) {
          const adminDoc = new User({
            name: 'System Admin',
            email: adminEmail,
            dob: '2000-01-01',
            role: 'admin',
            passwordHash: defaultHash,
            salt: defaultSalt
          });
          await adminDoc.save();
          console.log(`👤 Admin user seeded into MongoDB: ${adminEmail} (Role: admin)`);
        }
      } catch (err) {
        console.warn('Admin seed notice:', err.message);
      }
    }
  }

  /**
   * Register a new user and save directly into MongoDB Compass database
   */
  static async registerUser({ name, email, password, dob, role = 'user' }) {
    const normalizedEmail = email.toLowerCase().trim();
    const targetRole = (role && role.toLowerCase() === 'admin') ? 'admin' : 'user';

    // 1. Check MongoDB for existing user
    if (mongoose.connection.readyState === 1) {
      const existingUser = await User.findOne({ email: normalizedEmail });
      if (existingUser) {
        const error = new Error('An account with this email address already exists.');
        error.statusCode = 409;
        throw error;
      }

      // Check single admin rule
      if (targetRole === 'admin') {
        const existingAdmin = await User.findOne({ role: 'admin' });
        if (existingAdmin) {
          const error = new Error('An Admin account already exists in MongoDB. Only 1 Admin account is permitted. Please log in as Admin (admin@vibecode.com / Admin123!) or register as User.');
          error.statusCode = 409;
          throw error;
        }
      }

      const { hash, salt } = hashPassword(password);
      const newUser = new User({
        name: name.trim(),
        email: normalizedEmail,
        dob: dob || null,
        role: targetRole,
        passwordHash: hash,
        salt: salt
      });

      const savedUser = await newUser.save();
      const userId = savedUser._id.toString();

      // Sync memory map
      inMemoryUsers.set(normalizedEmail, {
        id: userId,
        _id: userId,
        name: savedUser.name,
        email: savedUser.email,
        dob: savedUser.dob,
        role: savedUser.role,
        passwordHash: hash,
        salt: salt
      });

      const token = generateToken({ id: userId, email: savedUser.email, role: savedUser.role });
      return {
        user: {
          id: userId,
          name: savedUser.name,
          email: savedUser.email,
          dob: savedUser.dob,
          role: savedUser.role
        },
        token
      };
    }

    // In-memory fallback if MongoDB is offline
    if (inMemoryUsers.has(normalizedEmail)) {
      const error = new Error('An account with this email address already exists.');
      error.statusCode = 409;
      throw error;
    }

    const { hash, salt } = hashPassword(password);
    const userId = `usr_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    const userObj = {
      id: userId,
      _id: userId,
      name: name.trim(),
      email: normalizedEmail,
      dob: dob || null,
      role: targetRole,
      passwordHash: hash,
      salt: salt,
      createdAt: new Date().toISOString()
    };

    inMemoryUsers.set(normalizedEmail, userObj);

    const token = generateToken({ id: userObj.id, email: userObj.email, role: userObj.role });
    return {
      user: {
        id: userObj.id,
        name: userObj.name,
        email: userObj.email,
        dob: userObj.dob,
        role: userObj.role
      },
      token
    };
  }

  /**
   * Authenticate a user with email & password from MongoDB Compass database
   */
  static async loginUser({ email, password }) {
    const normalizedEmail = email.toLowerCase().trim();

    // 1. Query MongoDB Compass
    if (mongoose.connection.readyState === 1) {
      const user = await User.findOne({ email: normalizedEmail });
      if (user) {
        const isValid = verifyPassword(password, user.passwordHash, user.salt);
        if (!isValid) {
          const error = new Error('Invalid email or password credentials.');
          error.statusCode = 401;
          throw error;
        }

        const userId = user._id.toString();
        const token = generateToken({ id: userId, email: user.email, role: user.role });
        return {
          user: {
            id: userId,
            name: user.name,
            email: user.email,
            dob: user.dob,
            role: user.role
          },
          token
        };
      }
    }

    // 2. Query in-memory fallback
    const user = inMemoryUsers.get(normalizedEmail);
    if (!user) {
      const error = new Error('Invalid email or password credentials.');
      error.statusCode = 401;
      throw error;
    }

    const isValid = verifyPassword(password, user.passwordHash, user.salt);
    if (!isValid) {
      const error = new Error('Invalid email or password credentials.');
      error.statusCode = 401;
      throw error;
    }

    const token = generateToken({ id: user.id, email: user.email, role: user.role });
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        dob: user.dob,
        role: user.role
      },
      token
    };
  }

  /**
   * Retrieve user profile by ID from MongoDB Compass
   */
  static async getUserById(id) {
    if (mongoose.connection.readyState === 1 && mongoose.Types.ObjectId.isValid(id)) {
      try {
        const user = await User.findById(id);
        if (user) {
          return {
            id: user._id.toString(),
            name: user.name,
            email: user.email,
            dob: user.dob,
            role: user.role
          };
        }
      } catch(e) {}
    }

    for (const user of inMemoryUsers.values()) {
      if (user.id === id || user._id === id) {
        return {
          id: user.id || user._id,
          name: user.name,
          email: user.email,
          dob: user.dob,
          role: user.role
        };
      }
    }
    return null;
  }

  /**
   * Update profile details (Name, Password) in MongoDB
   */
  static async updateUserProfile(userId, { name, newPassword }) {
    const updateData = {};
    if (name && name.trim()) updateData.name = name.trim();
    if (newPassword) {
      const { hash, salt } = hashPassword(newPassword);
      updateData.passwordHash = hash;
      updateData.salt = salt;
    }

    if (mongoose.connection.readyState === 1 && mongoose.Types.ObjectId.isValid(userId)) {
      try {
        const updated = await User.findByIdAndUpdate(userId, { $set: updateData }, { new: true });
        if (updated) {
          return {
            id: updated._id.toString(),
            name: updated.name,
            email: updated.email,
            dob: updated.dob,
            role: updated.role
          };
        }
      } catch (e) {}
    }

    // In-memory update
    for (const [email, user] of inMemoryUsers.entries()) {
      if (user.id === userId || user._id === userId) {
        if (name && name.trim()) user.name = name.trim();
        if (newPassword) {
          const { hash, salt } = hashPassword(newPassword);
          user.passwordHash = hash;
          user.salt = salt;
        }
        inMemoryUsers.set(email, user);
        return {
          id: user.id || user._id,
          name: user.name,
          email: user.email,
          dob: user.dob,
          role: user.role
        };
      }
    }

    const error = new Error('User account not found.');
    error.statusCode = 404;
    throw error;
  }

  /**
   * Verify token payload
   */
  static verifyTokenPayload(token) {
    return verifyToken(token);
  }
}

module.exports = AuthService;
