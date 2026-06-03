// ─────────────────────────────────────────────────────────────
//  Auth routes
//
//  POST /auth/login    — username + password + region → JWT cookies
//  POST /auth/logout   — clears cookies
//  POST /auth/refresh  — refresh token → new access token
//  GET  /auth/me       — returns current user info
// ─────────────────────────────────────────────────────────────
const express  = require('express');
const bcrypt   = require('bcryptjs');
const { getDb }       = require('../lib/prisma');
const { signToken, signRefresh, verifyToken } = require('../lib/jwt');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Cookie options — httpOnly prevents JS access (XSS protection)
const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'lax',
};

// ── POST /auth/login ──────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { username, password, region = 'us' } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const db   = getDb(region);
    const user = await db.user.findUnique({ where: { username } });

    if (!user) {
      // Timing-safe: still run bcrypt even if user not found
      await bcrypt.compare(password, '$2b$12$placeholder.hash.to.prevent.timing');
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Update last login
    await db.user.update({
      where: { id: user.id },
      data:  { lastLogin: new Date() },
    });

    const payload = { id: user.id, username: user.username, role: user.role, region };

    const accessToken  = signToken(payload);
    const refreshToken = signRefresh(payload);

    // Set tokens as httpOnly cookies
    res.cookie('access_token',  accessToken,  { ...COOKIE_OPTS, maxAge: 15 * 60 * 1000 });         // 15 min
    res.cookie('refresh_token', refreshToken, { ...COOKIE_OPTS, maxAge: 7 * 24 * 60 * 60 * 1000 }); // 7 days

    res.json({
      ok: true,
      user: { id: user.id, username: user.username, role: user.role, region },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── POST /auth/logout ─────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.clearCookie('access_token');
  res.clearCookie('refresh_token');
  res.json({ ok: true });
});

// ── POST /auth/refresh ────────────────────────────────────────
router.post('/refresh', (req, res) => {
  try {
    const token = req.cookies?.refresh_token;
    if (!token) return res.status(401).json({ error: 'No refresh token' });

    const payload      = verifyToken(token);
    const { iat, exp, ...clean } = payload; // strip old timestamps
    const accessToken  = signToken(clean);

    res.cookie('access_token', accessToken, { ...COOKIE_OPTS, maxAge: 15 * 60 * 1000 });
    res.json({ ok: true });
  } catch {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

// ── GET /auth/me ──────────────────────────────────────────────
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
