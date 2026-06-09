// ─────────────────────────────────────────────────────────────
//  Message service
//  All DB operations for messages.
//  In-memory buffer is kept in sync for fast Socket.io delivery.
// ─────────────────────────────────────────────────────────────
const { getDb } = require('../lib/prisma');
const crypto    = require('crypto');

// Hash IP for privacy — one-way, consistent per session
function hashIp(ip) {
  return crypto.createHash('sha256').update(ip + (process.env.IP_SALT || 'salt')).digest('hex').slice(0, 16);
}

// Save a new message to DB and return it
async function saveMessage({ content, eventId, region, ip, isVisible = true }) {
  const db = getDb(region);
  const msg = await db.message.create({
    data: {
      content,
      eventId,
      ipHash:    ip ? hashIp(ip) : null,
      isVisible,
    },
  });
  return { id: msg.id, text: msg.content, timestamp: msg.createdAt.getTime() };
}

// Load last N visible messages for the live wall
async function getVisibleMessages({ eventId, region, limit = 50 }) {
  const db   = getDb(region);
  const rows = await db.message.findMany({
    where:   { eventId, isVisible: true },
    orderBy: { createdAt: 'desc' },
    take:    limit,
  });
  return rows.map(m => ({ id: m.id, text: m.content, timestamp: m.createdAt.getTime() }));
}

// Soft-delete selected message IDs
async function deleteMessages({ ids, deletedById, region }) {
  // Guard: nothing to do if ids is empty
  if (!ids || ids.length === 0) return;

  const db = getDb(region);
  await db.message.updateMany({
    where: { id: { in: ids } },
    data:  { isVisible: false, deletedById, deletedAt: new Date() },
  });

  // Fetch eventId from first message for audit log
  const firstMsg = await db.message.findFirst({
    where:  { id: { in: ids } },
    select: { eventId: true },
  });

  if (firstMsg?.eventId) {
    await db.wallAction.create({
      data: {
        type:          'delete',
        detail:        { ids, count: ids.length },
        performedById: deletedById,
        eventId:       firstMsg.eventId,
      },
    });
  }
}

// Clear all visible messages for an event (refresh wall)
async function clearMessages({ eventId, userId, region }) {
  const db = getDb(region);
  await db.message.updateMany({
    where: { eventId, isVisible: true },
    data:  { isVisible: false },
  });
  await db.wallAction.create({
    data: {
      type:          'refresh',
      performedById: userId,
      eventId,
    },
  });
}

// Trim — keep last N visible messages, hide the rest
async function trimMessages({ eventId, keep, userId, region }) {
  const db      = getDb(region);
  const visible = await db.message.findMany({
    where:   { eventId, isVisible: true },
    orderBy: { createdAt: 'desc' },
    select:  { id: true },
  });

  if (visible.length <= keep) return [];

  const toHide = visible.slice(keep).map(m => m.id);
  await db.message.updateMany({
    where: { id: { in: toHide } },
    data:  { isVisible: false },
  });

  await db.wallAction.create({
    data: {
      type:          'trim',
      detail:        { keep, hidden: toHide.length },
      performedById: userId,
      eventId,
    },
  });

  return toHide;
}

// Auto-slide — hide oldest when wall exceeds limit
async function autoSlide({ eventId, limit, region }) {
  const db      = getDb(region);
  const visible = await db.message.findMany({
    where:   { eventId, isVisible: true },
    orderBy: { createdAt: 'asc' },  // oldest first
    select:  { id: true },
  });

  if (visible.length <= limit) return [];

  const excess = visible.slice(0, visible.length - limit);
  const ids    = excess.map(m => m.id);

  await db.message.updateMany({
    where: { id: { in: ids } },
    data:  { isVisible: false },
  });

  return ids;
}

// Full history for review page
async function getHistory({ eventId, region, includeDeleted = false }) {
  const db   = getDb(region);
  const rows = await db.message.findMany({
    where:   includeDeleted ? { eventId } : { eventId, isVisible: true },
    orderBy: { createdAt: 'asc' },
    include: { deletedBy: { select: { username: true } } },
  });
  return rows;
}

module.exports = {
  saveMessage, getVisibleMessages, deleteMessages,
  clearMessages, trimMessages, autoSlide, getHistory,
};
