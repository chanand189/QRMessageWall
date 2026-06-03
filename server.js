require('dotenv').config();
const express      = require('express');
const http         = require('http');
const { Server }   = require('socket.io');
const path         = require('path');
const os           = require('os');
const cookieParser = require('cookie-parser');

const { authenticate, requireRole } = require('./src/middleware/auth');
const authRoutes    = require('./src/routes/auth');
const messageRoutes = require('./src/routes/messages');
const photoRoutes   = require('./src/routes/photos');
const reviewRoutes  = require('./src/routes/review');
const userRoutes    = require('./src/routes/users');
const themeRoutes   = require('./src/routes/theme');
const eventRoutes   = require('./src/routes/events');
const { getActiveEvent } = require('./src/services/eventService');
const { getVisibleMessages } = require('./src/services/messageService');

// ── App setup ────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server);
const PORT   = process.env.PORT || 3000;

const BASE_URL = process.env.PUBLIC_URL
  || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null)
  || `http://${getLocalIP()}:${PORT}`;

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets))
    for (const net of nets[name])
      if (net.family === 'IPv4' && !net.internal) return net.address;
  return '127.0.0.1';
}

// ── Middleware ───────────────────────────────────────────────
app.use(express.json());
app.use(cookieParser());
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  // Attach io to every request so routes can emit events
  req.io = io;
  next();
});

app.get('/healthz', (req, res) => res.sendStatus(200));
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes ───────────────────────────────────────────────────
app.use('/auth',   authRoutes);
app.use('/',       messageRoutes);
app.use('/events', eventRoutes);
app.use('/photos', photoRoutes);
app.use('/review', reviewRoutes);
app.use('/users',  userRoutes);
app.use('/theme',  themeRoutes);

// ── Pages ────────────────────────────────────────────────────
app.get('/login', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'login.html')));

app.get('/submit', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'submit.html')));

// Admin dashboard — full UI
app.get('/admin/dashboard', authenticate, requireRole('moderator', 'admin'), (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'admin', 'dashboard.html')));

// Admin review page
app.get('/admin/review', authenticate, requireRole('moderator', 'admin'), (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'admin', 'review.html')));
app.get('/history/export', authenticate, requireRole('moderator', 'admin'), async (req, res) => {
  try {
    const { getHistory } = require('./src/services/messageService');
    const eventId        = req.query.eventId;
    const region         = req.user.region;
    if (!eventId) return res.status(400).json({ error: 'eventId required' });

    const messages = await getHistory({ eventId, region, includeDeleted: true });
    const rows     = [
      ['id', 'content', 'createdAt', 'isVisible', 'deletedBy', 'deletedAt'],
      ...messages.map(m => [
        m.id, `"${m.content.replace(/"/g, '""')}"`,
        m.createdAt, m.isVisible,
        m.deletedBy?.username || '', m.deletedAt || '',
      ]),
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="event-${eventId}.csv"`);
    res.send(rows.map(r => r.join(',')).join('\n'));
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: 'Export failed' });
  }
});

// ── QR code (uses active event QR if available) ──────────────
app.get('/qrcode', async (req, res) => {
  try {
    const region = req.query.region || 'us';
    const active = await getActiveEvent(region);
    if (active?.qrCodeUrl) {
      return res.json({ qr: active.qrCodeUrl, url: active.submitUrl });
    }
    // Fallback — no active event
    const QRCode    = require('qrcode');
    const submitUrl = `${BASE_URL}/submit`;
    const qr        = await QRCode.toDataURL(submitUrl, {
      width: 400, margin: 2,
      color: { dark: '#1a1a2e', light: '#ffffff' },
    });
    res.json({ qr, url: submitUrl });
  } catch {
    res.status(500).json({ error: 'QR generation failed' });
  }
});

// ── Socket.io — send history on connect ─────────────────────
io.on('connection', async (socket) => {
  try {
    // Try to load messages from DB for default region
    // Wall page will pass region via query in Phase 4
    const region = 'us';
    const active = await getActiveEvent(region);
    if (active) {
      const messages = await getVisibleMessages({ eventId: active.id, region });
      socket.emit('history', messages);
    } else {
      socket.emit('history', []);
    }
  } catch {
    socket.emit('history', []);
  }
});

// ── Start ────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Listening on port : ${PORT}`);
  console.log(`Wall display      : ${BASE_URL}`);
  console.log(`Login page        : ${BASE_URL}/login`);
});
