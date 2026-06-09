// ─────────────────────────────────────────────────────────────
//  Message routes
//
//  POST   /message          — submit message (public, QR scan)
//  GET    /messages         — get live wall messages
//  POST   /clear-messages   — clear wall (moderator+)
//  POST   /trim-messages    — keep last N (moderator+)
//  DELETE /messages         — delete selected (moderator+)
//  GET    /history          — full event history (moderator+)
// ─────────────────────────────────────────────────────────────
const express      = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { getActiveEvent }   = require('../services/eventService');
const { moderateMessage }  = require('../services/moderationService');
const {
  saveMessage, getVisibleMessages, deleteMessages,
  clearMessages, trimMessages, autoSlide, getHistory,
} = require('../services/messageService');

const router = express.Router();

// ── POST /message (public — QR scan) ─────────────────────────
router.post('/message', async (req, res) => {
  try {
    const text    = ((req.body?.text) || '').trim().slice(0, 200);
    const region  = req.body?.region || 'us';
    const eventId = req.body?.eventId;

    if (!text) return res.status(400).json({ error: 'Empty message' });

    // AI moderation
    const verdict = await moderateMessage(text);

    if (verdict.blocked) {
      return res.status(400).json({ error: verdict.reason });
    }

    // REVIEW — save but mark not visible, notify moderators
    if (verdict.review) {
      const active = eventId ? null : await getActiveEvent(region);
      const resolvedEventId = eventId || active?.id;
      if (!resolvedEventId) return res.status(400).json({ error: 'No active event.' });

      const ip  = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
      const msg = await saveMessage({ content: text, eventId: resolvedEventId, region, ip, isVisible: false });

      // Notify moderators only (not viewers)
      req.io.emit('message-needs-review', {
        id:         msg.id,
        text:       text,
        reason:     verdict.reason,
        categories: verdict.categories,
        severity:   verdict.severity,
      });

      return res.json({ ok: true, status: 'review', message: 'Your message is being reviewed before appearing on the wall.' });
    }

    // ALLOW — resolve event and post
    let resolvedEventId = eventId;
    if (!resolvedEventId) {
      const active = await getActiveEvent(region);
      if (!active) return res.status(400).json({ error: 'No active event. Please scan the correct QR code.' });
      resolvedEventId = active.id;
    }

    const ip  = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
    const msg = await saveMessage({ content: text, eventId: resolvedEventId, region, ip });

    // Fetch event config (needed for autoSlide)
    const { getDb } = require('../lib/prisma');
    const db        = getDb(region);
    const event     = await db.event.findUnique({
      where:  { id: resolvedEventId },
      select: { autoSlide: true, wallLimit: true },
    });

    // Respond immediately — autoSlide runs in background
    req.io.emit('new-message', msg);
    res.json({ ok: true, status: 'posted' });

    // Auto-slide in background (non-blocking — does not delay response)
    if (event?.autoSlide) {
      autoSlide({ eventId: resolvedEventId, limit: event.wallLimit, region })
        .then(hiddenIds => { if (hiddenIds.length) req.io.emit('hide-messages', hiddenIds); })
        .catch(err => console.error('autoSlide error:', err));
    }
  } catch (err) {
    console.error('Post message error:', err);
    res.status(500).json({ error: 'Failed to post message' });
  }
});

// ── POST /messages/:id/approve (moderator+) ──────────────────
router.post('/messages/:id/approve', authenticate, requireRole('moderator', 'admin'), async (req, res) => {
  try {
    const region = req.user.region;
    const { getDb } = require('../lib/prisma');
    const db = getDb(region);
    const msg = await db.message.update({
      where: { id: req.params.id },
      data:  { isVisible: true },
    });
    const formatted = { id: msg.id, text: msg.content, timestamp: msg.createdAt.getTime() };
    req.io.emit('new-message', formatted);
    res.json({ ok: true });
  } catch (err) {
    console.error('Approve error:', err);
    res.status(500).json({ error: 'Failed to approve message' });
  }
});

// ── GET /messages (public) ────────────────────────────────────
router.get('/messages', async (req, res) => {
  try {
    const region  = req.query.region || 'us';
    const active  = await getActiveEvent(region);
    if (!active) return res.json([]);
    const msgs = await getVisibleMessages({ eventId: active.id, region });
    res.json(msgs);
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// ── POST /clear-messages (moderator+) ────────────────────────
router.post('/clear-messages', authenticate, requireRole('moderator', 'admin'), async (req, res) => {
  try {
    const region = req.user.region;
    const active = await getActiveEvent(region);
    if (!active) return res.status(400).json({ error: 'No active event' });

    await clearMessages({ eventId: active.id, userId: req.user.id, region });
    req.io.emit('clear-wall');
    res.json({ ok: true });
  } catch (err) {
    console.error('Clear error:', err);
    res.status(500).json({ error: 'Failed to clear wall' });
  }
});

// ── POST /trim-messages (moderator+) ─────────────────────────
router.post('/trim-messages', authenticate, requireRole('moderator', 'admin'), async (req, res) => {
  try {
    const region = req.user.region;
    const keep   = parseInt(req.body?.keep) || 10;
    const active = await getActiveEvent(region);
    if (!active) return res.status(400).json({ error: 'No active event' });

    const hiddenIds = await trimMessages({ eventId: active.id, keep, userId: req.user.id, region });
    if (hiddenIds.length) req.io.emit('hide-messages', hiddenIds);
    res.json({ ok: true, hidden: hiddenIds.length });
  } catch (err) {
    console.error('Trim error:', err);
    res.status(500).json({ error: 'Failed to trim messages' });
  }
});

// ── DELETE /messages (moderator+) ────────────────────────────
router.delete('/messages', authenticate, requireRole('moderator', 'admin'), async (req, res) => {
  try {
    const ids    = req.body?.ids || [];
    const region = req.user.region;
    if (!ids.length) return res.status(400).json({ error: 'No message IDs provided' });

    await deleteMessages({ ids, deletedById: req.user.id, region });
    req.io.emit('remove-messages', ids);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Failed to delete messages' });
  }
});

// ── GET /history (moderator+) ─────────────────────────────────
router.get('/history', authenticate, requireRole('moderator', 'admin'), async (req, res) => {
  try {
    const region        = req.user.region;
    const eventId       = req.query.eventId;
    const includeDeleted = req.query.includeDeleted === 'true';
    if (!eventId) return res.status(400).json({ error: 'eventId required' });

    const messages = await getHistory({ eventId, region, includeDeleted });
    res.json(messages);
  } catch (err) {
    console.error('History error:', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

module.exports = router;
