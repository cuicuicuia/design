const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { config } = require('./config');

function normalizeEmail(email) {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

function normalizeUsername(username) {
  if (typeof username !== 'string') return null;
  const u = username.trim();
  if (!u) return null;
  return u;
}

function isValidEmail(email) {
  if (!email) return false;
  // 轻量校验：避免过度严格
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320;
}

function isValidPassword(pw) {
  return typeof pw === 'string' && pw.length >= 8 && pw.length <= 128;
}

async function hashPassword(password) {
  const saltRounds = 12;
  return bcrypt.hash(password, saltRounds);
}

async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

function newUserUuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function signAccessToken(payload) {
  return jwt.sign(payload, config.auth.jwtSecret, {
    expiresIn: config.auth.jwtExpiresIn,
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, config.auth.jwtSecret);
}

module.exports = {
  normalizeEmail,
  normalizeUsername,
  isValidEmail,
  isValidPassword,
  hashPassword,
  verifyPassword,
  newUserUuid,
  signAccessToken,
  verifyAccessToken,
};

