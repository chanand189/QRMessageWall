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

// ── Pages ────────────────────────────────────────────────────
app.get('/login', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'login.html')));

app.get('/submit', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'submit.html')));

// Admin dashboard placeholder — full UI built in Phase 4
app.get('/admin/dashboard', authenticate, requireRole('moderator', 'admin'), (req, res) =>
  res.json({ message: `Welcome ${req.user.username} (${req.user.role}) — dashboard coming in Phase 4` }));

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
