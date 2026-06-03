// ─────────────────────────────────────────────────────────────
//  Theme routes
//
//  GET  /theme        — get current theme for active event
//  POST /theme        — set theme (moderator+)
// ─────────────────────────────────────────────────────────────
const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { getTheme, setTheme, THEMES } = require('../services/themeService');
const { getActiveEvent } = require('../services/eventService');

const router = express.Router();

// GET /theme — public (wall reads this)
router.get('/', async (req, res) => {
  try {
    const region = req.query.region || 'us';
    const active = await getActiveEvent(region);
    if (!active) return res.json({ theme: 'cosmic' });
    const theme = await getTheme({ eventId: active.id, region });
    res.json({ theme });
  } catch {
    res.json({ theme: 'cosmic' });
  }
});

// POST /theme — moderator+
router.post('/', authenticate, requireRole('moderator', 'admin'), async (req, res) => {
  try {
    const { theme } = req.body;
    const region    = req.user.region;
    const active    = await getActiveEvent(region);
    if (!active) return res.status(400).json({ error: 'No active event' });
    await setTheme({ eventId: active.id, userId: req.user.id, theme, region });
    req.io.emit('theme-changed', { theme });
    res.json({ ok: true, theme });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to set theme' });
  }
});

module.exports = router;
