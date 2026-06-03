// ─────────────────────────────────────────────────────────────
//  Event service
//  Handles creating, retrieving and ending events per region
// ─────────────────────────────────────────────────────────────
const { getDb } = require('../lib/prisma');
const QRCode    = require('qrcode');

// Get the currently active (live) event for a region
async function getActiveEvent(region) {
  const db = getDb(region);
  return db.event.findFirst({
    where: { status: 'live' },
    orderBy: { startedAt: 'desc' },
  });
}

// Create a new event and set it live
async function createEvent({ name, type = 'other', createdById, region, submitUrl }) {
  const db = getDb(region);

  const event = await db.event.create({
    data: {
      name,
      type,
      status:    'live',
      startedAt: new Date(),
      createdById,
    },
  });

  // Generate unique QR for this event
  const eventSubmitUrl = `${submitUrl}?eventId=${event.id}`;
  const qrDataUrl      = await QRCode.toDataURL(eventSubmitUrl, {
    width: 400, margin: 2,
    color: { dark: '#1a1a2e', light: '#ffffff' },
  });

  // Save QR + submitUrl back to event
  const updated = await db.event.update({
    where: { id: event.id },
    data:  { qrCodeUrl: qrDataUrl, submitUrl: eventSubmitUrl },
  });

  // Log action
  await db.wallAction.create({
    data: {
      type:          'event_start',
      detail:        { name, type },
      performedById: createdById,
      eventId:       event.id,
    },
  });

  return updated;
}

// End an event
async function endEvent({ eventId, userId, region }) {
  const db = getDb(region);

  const event = await db.event.update({
    where: { id: eventId },
    data:  { status: 'ended', endedAt: new Date() },
  });

  await db.wallAction.create({
    data: {
      type:          'event_end',
      performedById: userId,
      eventId,
    },
  });

  return event;
}

// List all events (for admin dashboard)
async function listEvents({ region, status } = {}) {
  const db = getDb(region);
  return db.event.findMany({
    where:   status ? { status } : {},
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { messages: true } },
      createdBy: { select: { username: true } },
    },
  });
}

module.exports = { getActiveEvent, createEvent, endEvent, listEvents };
