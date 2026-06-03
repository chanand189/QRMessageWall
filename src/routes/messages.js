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
const express     = require('express');
const leoProfanity = require('leo-profanity');
const { authenticate, requireRole } = require('../middleware/auth');
const { getActiveEvent }            = require('../services/eventService');
const {
  saveMessage, getVisibleMessages, deleteMessages,
  clearMessages, trimMessages, autoSlide, getHistory,
} = require('../services/messageService');

const router = express.Router();

// Content moderation patterns (kept here for route use)
const NEGATIVE_PATTERNS = [
  /\bkill\s*(your|ur)\s*self\b/i, /\bkys\b/i, /\bgo\s*(die|hang)\b/i,
  /\byou\s*(are|r|'re)\s*(worthless|pathetic|disgusting|ugly|stupid|a\s*loser|trash|garbage|nothing|a\s*waste)\b/i,
  /\bno\s*one\s*(likes|loves|wants|cares\s*about)\s*you\b/i,
  /\byou\s*should\s*(die|not\s*exist|disappear|end\s*it)\b/i,
  /\bI\s*hate\s*(you|everyone|all\s*of\s*you)\b/i,
  /\bdie\s*(slow|painfully|already)\b/i,
  /\b(loser|idiot|moron|imbecile|scum|vermin|freak)\b/i,
  /\bshame\s*on\s*you\b/i, /\byou\s*(deserve|deserved)\s*it\b/i,
];
const HARMFUL_PATTERNS = [
  /\b(i('ll|\s*will|\s*am\s*going\s*to)|gonna)\s*(kill|shoot|stab|bomb|attack|hurt|murder)\b/i,
  /\b(bomb|explosive|grenade)\s*(threat|attack|you|this\s*place)\b/i,
  /\b(shoot|gun|knife)\s*(you|everyone|them|him|her)\b/i,
  /\bself[\s-]?harm\b/i, /\bcut\s*(yourself|myself|my\s*wrist)\b/i,
  /\b(suicide|suicidal)\b/i, /\bend\s*(my|your|their)\s*life\b/i,
  /\b(buy|sell|deal|score)\s*(drugs|meth|cocaine|heroin|fentanyl)\b/i,
  /\bhow\s*to\s*(make\s*a\s*(bomb|weapon)|buy\s*(guns|drugs))\b/i,
];

function moderateMessage(text) {
  if (leoProfanity.check(text)) return { blocked: true, reason: 'Message contains profanity or abusive language.' };
  for (const p of NEGATIVE_PATTERNS) if (p.test(text)) return { blocked: true, reason: 'Message contains hostile or harmful sentiments.' };
  for (const p of HARMFUL_PATTERNS)  if (p.test(text)) return { blocked: true, reason: 'Message contains threatening or harmful content.' };
  return { blocked: false };
}

// ── POST /message (public — QR scan) ─────────────────────────
router.post('/message', async (req, res) => {
  try {
    const text    = ((req.body?.text) || '').trim().slice(0, 200);
    const region  = req.body?.region || 'us';
    const eventId = req.body?.eventId;

    if (!text) return res.status(400).json({ error: 'Empty message' });

    const verdict = moderateMessage(text);
    if (verdict.blocked) return res.status(400).json({ error: verdict.reason });

    // Resolve event — use eventId from body or fall back to active event
    let resolvedEventId = eventId;
    if (!resolvedEventId) {
      const active = await getActiveEvent(region);
      if (!active) return res.status(400).json({ error: 'No active event. Please scan the correct QR code.' });
      resolvedEventId = active.id;
    }

    const ip  = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
    const msg = await saveMessage({ content: text, eventId: resolvedEventId, region, ip });

    // Auto-slide if event has a wall limit
    const { getDb } = require('../lib/prisma');
    const db        = getDb(region);
    const event     = await db.event.findUnique({ where: { id: resolvedEventId } });

    if (event?.autoSlide) {
      const hiddenIds = await autoSlide({ eventId: resolvedEventId, limit: event.wallLimit, region });
      if (hiddenIds.length) req.io.emit('hide-messages', hiddenIds);
    }

    req.io.emit('new-message', msg);
    res.json({ ok: true });
  } catch (err) {
    console.error('Post message error:', err);
    res.status(500).json({ error: 'Failed to post message' });
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
