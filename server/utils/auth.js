const jwt = require('jsonwebtoken');
const { findUserById } = require('./db');

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('JWT_SECRET env var is required (>= 16 chars).');
  }
  return secret;
}

function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username }, getJwtSecret(), { expiresIn: '30d' });
}

function verifyToken(token) {
  return jwt.verify(token, getJwtSecret());
}

// Admin usernames come from .env (ADMIN_USERNAME, comma-separated allowed).
function getAdminUsernames() {
  return (process.env.ADMIN_USERNAME || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function isAdminUsername(username) {
  if (!username) return false;
  return getAdminUsernames().includes(username.toLowerCase());
}

function isAdminUser(user) {
  return !!user && user.role === 'admin';
}

function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token.' });
  try {
    const payload = verifyToken(token);
    const user = findUserById(payload.sub);
    if (!user) return res.status(401).json({ error: 'User not found.' });
    if (user.approved === 0) return res.status(403).json({ error: 'Tài khoản đang chờ admin duyệt.' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

function requireAdmin(req, res, next) {
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ error: 'Chỉ admin mới có quyền truy cập.' });
  }
  next();
}

module.exports = { signToken, verifyToken, requireAuth, requireAdmin, isAdminUsername, isAdminUser };
