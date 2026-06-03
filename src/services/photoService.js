// ─────────────────────────────────────────────────────────────
//  Photo Queue service
//
//  enqueuePhoto    — save photo to R2 + DB with status=queued
//  getQueue        — get all queued photos for an event
//  markDisplaying  — set status=displaying on current photo
//  markDisplayed   — set status=displayed + delete from R2
//  getNextPhoto    — get next queued photo
// ─────────────────────────────────────────────────────────────
const { getDb }      = require('../lib/prisma');
const { uploadPhoto, deletePhoto } = require('../lib/r2');

async function enqueuePhoto({ buffer, mimetype, caption, submittedBy, eventId, region, ip, durationSec = 4 }) {
  // Upload to R2 first
  const { url, key } = await uploadPhoto({ buffer, mimetype, eventId });

  // Save metadata to DB
  const db    = getDb(region);
  const photo = await db.photoQueue.create({
    data: {
      storageUrl:  url,
      storageKey:  key,
      caption:     caption || null,
      submittedBy: submittedBy || 'Anonymous',
      ipHash:      ip ? require('crypto').createHash('sha256').update(ip).digest('hex').slice(0, 16) : null,
      eventId,
      durationSec,
      status:      'queued',
    },
  });

  return photo;
}

async function getQueue({ eventId, region }) {
  const db = getDb(region);
  return db.photoQueue.findMany({
    where:   { eventId, status: 'queued' },
    orderBy: { submittedAt: 'asc' },
  });
}

async function getNextPhoto({ eventId, region }) {
  const db = getDb(region);
  return db.photoQueue.findFirst({
    where:   { eventId, status: 'queued' },
    orderBy: { submittedAt: 'asc' },
  });
}

async function markDisplaying({ photoId, region }) {
  const db = getDb(region);
  return db.photoQueue.update({
    where: { id: photoId },
    data:  { status: 'displaying' },
  });
}

async function markDisplayed({ photoId, region }) {
  const db    = getDb(region);
  const photo = await db.photoQueue.update({
    where: { id: photoId },
    data:  { status: 'displayed', displayedAt: new Date() },
  });

  // Delete from R2 immediately after display
  await deletePhoto(photo.storageKey);

  return photo;
}

async function getQueueCount({ eventId, region }) {
  const db = getDb(region);
  return db.photoQueue.count({
    where: { eventId, status: 'queued' },
  });
}

module.exports = { enqueuePhoto, getQueue, getNextPhoto, markDisplaying, markDisplayed, getQueueCount };
