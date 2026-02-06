/**
 * JWT Authentication Middleware
 * 
 * Checks for a valid JWT in:
 * 1. Authorization: Bearer <token> header
 * 2. token cookie
 * 
 * Attaches user info to req.user if valid.
 */

const jwt = require('jsonwebtoken');

function authRequired(req, res, next) {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function authOptional(req, res, next) {
  const token = extractToken(req);

  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      // Invalid token, just continue without user
    }
  }

  next();
}

function extractToken(req) {
  // Check Authorization header first
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // Check cookie
  if (req.cookies && req.cookies.token) {
    return req.cookies.token;
  }

  return null;
}

module.exports = { authRequired, authOptional };
