// ─────────────────────────────────────────────────────────────
//  JWT helpers
//  signToken   — creates access token (short-lived 15m)
//  signRefresh — creates refresh token (7 days)
//  verifyToken — verifies and decodes any token
// ─────────────────────────────────────────────────────────────
const jwt = require('jsonwebtoken');

const SECRET           = process.env.JWT_SECRET;
const EXPIRES_IN       = process.env.JWT_EXPIRES_IN       || '2h';
const REFRESH_EXPIRES  = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

function signRefresh(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: REFRESH_EXPIRES });
}

function verifyToken(token) {
  return jwt.verify(token, SECRET); // throws if invalid/expired
}

module.exports = { signToken, signRefresh, verifyToken };
