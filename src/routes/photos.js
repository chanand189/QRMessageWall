// ─────────────────────────────────────────────────────────────
//  Photo routes
//
//  POST /photos/upload     — submit photo (public, from QR scan)
//  GET  /photos/queue      — get queue count + list (mod+)
//  GET  /photos/next       — get next photo to display (wall)
//  POST /photos/:id/displayed — mark displayed + delete from R2
// ─────────────────────────────────────────────────────────────
const express = require('express');
const multer  = require('multer');
const { authenticate, requireRole } = require('../middleware/auth');
const { getActiveEvent }   = require('../services/eventService');
const {
  enqueuePhoto, getQueue, getNextPhoto,
  markDisplaying, markDisplayed, getQueueCount,
} = require('../services/photoService');

const router = express.Router();

// Multer — memory storage, 10MB limit, images only
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// ── POST /photos/upload (public) ──────────────────────────────
router.post('/upload', upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No photo provided' });

    const region  = req.body?.region  || 'us';
    const caption = (req.body?.caption || '').trim().slice(0, 200);
    const name    = (req.body?.name    || 'Anonymous').trim().slice(0, 50);
    const eventId = req.body?.eventId;

    // Resolve event
    let resolvedEventId = eventId;
    if (!resolvedEventId) {
      const active = await getActiveEvent(region);
      if (!active) return res.status(400).json({ error: 'No active event' });
      resolvedEventId = active.id;
    }

    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;

    const photo = await enqueuePhoto({
      buffer:      req.file.buffer,
      mimetype:    req.file.mimetype,
      caption,
      submittedBy: name,
      eventId:     resolvedEventId,
      region,
      ip,
    });

    // Notify wall that a new photo is queued
    req.io.emit('photo-queued', {
      id:          photo.id,
      queueCount:  await getQueueCount({ eventId: resolvedEventId, region }),
    });

    res.json({ ok: true, position: await getQueueCount({ eventId: resolvedEventId, region }) });
  } catch (err) {
    console.error('Photo upload error:', err);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// ── GET /photos/queue (moderator+) ───────────────────────────
router.get('/queue', authenticate, requireRole('moderator', 'admin'), async (req, res) => {
  try {
    const region = req.user.region;
    const active = await getActiveEvent(region);
    if (!active) return res.json({ count: 0, photos: [] });

    const photos = await getQueue({ eventId: active.id, region });
    res.json({ count: photos.length, photos });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get queue' });
  }
});

// ── GET /photos/next (wall — gets next photo to show) ─────────
router.get('/next', async (req, res) => {
  try {
    const region = req.query.region || 'us';
    const active = await getActiveEvent(region);
    if (!active) return res.json({ photo: null });

    const photo = await getNextPhoto({ eventId: active.id, region });
    if (!photo) return res.json({ photo: null });

    // Mark as displaying
    await markDisplaying({ photoId: photo.id, region });
    res.json({ photo });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get next photo' });
  }
});

// ── POST /photos/:id/displayed (wall — after display) ─────────
router.post('/:id/displayed', async (req, res) => {
  try {
    const region = req.body?.region || 'us';
    await markDisplayed({ photoId: req.params.id, region });

    // Notify all clients
    req.io.emit('photo-displayed', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark displayed' });
  }
});

module.exports = router;
