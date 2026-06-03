// ─────────────────────────────────────────────────────────────
//  Review service
//  Generates stats, word cloud and summary for a past event
// ─────────────────────────────────────────────────────────────
const { getDb } = require('../lib/prisma');

// Get full event stats
async function getEventStats({ eventId, region }) {
  const db = getDb(region);

  const [event, totalMessages, visibleMessages, deletedMessages, photos, actions] = await Promise.all([
    db.event.findUnique({
      where:   { id: eventId },
      include: { createdBy: { select: { username: true } } },
    }),
    db.message.count({ where: { eventId } }),
    db.message.count({ where: { eventId, isVisible: true } }),
    db.message.count({ where: { eventId, isVisible: false } }),
    db.photoQueue.count({ where: { eventId } }),
    db.wallAction.findMany({
      where:   { eventId },
      orderBy: { performedAt: 'asc' },
      include: { performedBy: { select: { username: true } } },
    }),
  ]);

  return {
    event,
    stats: {
      totalMessages,
      visibleMessages,
      deletedMessages,
      totalPhotos: photos,
      totalActions: actions.length,
    },
    actions,
  };
}

// Generate word cloud data from messages
async function getWordCloud({ eventId, region }) {
  const db   = getDb(region);
  const msgs = await db.message.findMany({
    where:  { eventId, isVisible: true },
    select: { content: true },
  });

  // Stop words to exclude
  const STOP_WORDS = new Set([
    'the','a','an','and','or','but','in','on','at','to','for','of','with',
    'is','are','was','were','be','been','have','has','had','do','does','did',
    'will','would','could','should','may','might','i','you','he','she','we',
    'they','it','this','that','my','your','our','their','its','me','him','her',
    'us','them','what','which','who','how','when','where','why','all','just',
    'so','if','as','not','no','yes','up','out','get','got','go','can','im',
    'its','its','very','really','great','good','love','happy','thank','thanks',
  ]);

  const wordCount = {};
  msgs.forEach(m => {
    m.content
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
      .forEach(w => { wordCount[w] = (wordCount[w] || 0) + 1; });
  });

  return Object.entries(wordCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([word, count]) => ({ word, count }));
}

// Get messages grouped by time buckets (for timeline)
async function getTimeline({ eventId, region }) {
  const db   = getDb(region);
  const msgs = await db.message.findMany({
    where:   { eventId },
    orderBy: { createdAt: 'asc' },
    select:  { createdAt: true },
  });

  if (!msgs.length) return [];

  // Group into 5-minute buckets
  const buckets = {};
  msgs.forEach(m => {
    const d   = new Date(m.createdAt);
    const key = new Date(Math.floor(d.getTime() / 300000) * 300000).toISOString();
    buckets[key] = (buckets[key] || 0) + 1;
  });

  return Object.entries(buckets).map(([time, count]) => ({ time, count }));
}

module.exports = { getEventStats, getWordCloud, getTimeline };
