// ─────────────────────────────────────────────────────────────
//  Event routes
//
//  POST /events          — create new event (admin only)
//  GET  /events          — list all events (moderator+)
//  GET  /events/active   — get current live event
//  POST /events/:id/end  — end an event (admin only)
// ─────────────────────────────────────────────────────────────
const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { createEvent, getActiveEvent, endEvent, listEvents } = require('../services/eventService');

const router = express.Router();

// ── POST /events (admin only) ─────────────────────────────────
router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { name, type } = req.body;
    if (!name) return res.status(400).json({ error: 'Event name is required' });

    const region    = req.user.region;
    const submitUrl = `${process.env.PUBLIC_URL || ''}/submit`;

    const event = await createEvent({
      name, type, region, submitUrl,
      createdById: req.user.id,
    });

    // Notify all connected clients about new event
    req.io.emit('event-started', { id: event.id, name: event.name, type: event.type });
    res.json({ ok: true, event });
  } catch (err) {
    console.error('Create event error:', err);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// ── GET /events (moderator+) ──────────────────────────────────
router.get('/', authenticate, requireRole('moderator', 'admin'), async (req, res) => {
  try {
    const region = req.user.region;
    const status = req.query.status; // optional filter: draft | live | ended
    const events = await listEvents({ region, status });
    res.json(events);
  } catch (err) {
    console.error('List events error:', err);
    res.status(500).json({ error: 'Failed to list events' });
  }
});

// ── GET /events/active (public) ───────────────────────────────
router.get('/active', async (req, res) => {
  try {
    const region = req.query.region || 'us';
    const event  = await getActiveEvent(region);
    if (!event) return res.json({ active: false });
    res.json({ active: true, event: { id: event.id, name: event.name, type: event.type, qrCodeUrl: event.qrCodeUrl } });
  } catch (err) {
    console.error('Active event error:', err);
    res.status(500).json({ error: 'Failed to get active event' });
  }
});

// ── PATCH /events/:id/slide-limit (moderator+) ───────────────
router.patch('/:id/slide-limit', authenticate, requireRole('moderator', 'admin'), async (req, res) => {
  try {
    const db       = require('../lib/prisma').getDb(req.user.region);
    const wallLimit = parseInt(req.body?.wallLimit) || 20;
    const event    = await db.event.update({
      where: { id: req.params.id },
      data:  { wallLimit },
    });
    res.json({ ok: true, wallLimit: event.wallLimit });
  } catch (err) {
    console.error('Slide limit error:', err);
    res.status(500).json({ error: 'Failed to update slide limit' });
  }
});

// ── POST /events/:id/end (admin only) ─────────────────────────
router.post('/:id/end', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const region  = req.user.region;
    const eventId = req.params.id;
    const event   = await endEvent({ eventId, userId: req.user.id, region });

    req.io.emit('event-ended', { id: event.id, name: event.name });
    res.json({ ok: true, event });
  } catch (err) {
    console.error('End event error:', err);
    res.status(500).json({ error: 'Failed to end event' });
  }
});

module.exports = router;
