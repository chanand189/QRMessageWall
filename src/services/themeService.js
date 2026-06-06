// ─────────────────────────────────────────────────────────────
//  Theme service
//  Stores active wall theme in DB event record
//  Available themes: cosmic (default), poster, neon, minimal
// ─────────────────────────────────────────────────────────────
const { getDb } = require('../lib/prisma');

const THEMES = ['cosmic', 'sticky', 'pills'];

async function getTheme({ eventId, region }) {
  if (!eventId) return 'cosmic';
  const db    = getDb(region);
  const event = await db.event.findUnique({ where: { id: eventId }, select: { id: true } });
  // Store theme in a simple way using wallActions detail
  const action = await db.wallAction.findFirst({
    where:   { eventId, type: 'slide', detail: { path: ['theme'], not: null } },
    orderBy: { performedAt: 'desc' },
  });
  return action?.detail?.theme || 'cosmic';
}

async function setTheme({ eventId, userId, theme, region }) {
  if (!THEMES.includes(theme)) throw new Error('Invalid theme');
  const db = getDb(region);
  await db.wallAction.create({
    data: {
      type:          'slide',
      detail:        { theme },
      performedById: userId,
      eventId,
    },
  });
  return theme;
}

module.exports = { getTheme, setTheme, THEMES };
