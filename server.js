const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const path = require('path');
const os = require('os');
const leoProfanity = require('leo-profanity');

// ── App setup ────────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Priority: PUBLIC_URL env var (custom domain) → Railway auto domain → local LAN IP
const BASE_URL = process.env.PUBLIC_URL
  || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null)
  || `http://${getLocalIP()}:${PORT}`;

const SUBMIT_URL = `${BASE_URL}/submit`;

let messages = [];
const MAX_MESSAGES = 50;

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

// ── Content moderation ───────────────────────────────────────────────────────
const NEGATIVE_PATTERNS = [
  /\bkill\s*(your|ur)\s*self\b/i,
  /\bkys\b/i,
  /\bgo\s*(die|hang)\b/i,
  /\byou\s*(are|r|'re)\s*(worthless|pathetic|disgusting|ugly|stupid|a\s*loser|trash|garbage|nothing|a\s*waste)\b/i,
  /\bno\s*one\s*(likes|loves|wants|cares\s*about)\s*you\b/i,
  /\byou\s*should\s*(die|not\s*exist|disappear|end\s*it)\b/i,
  /\bI\s*hate\s*(you|everyone|all\s*of\s*you)\b/i,
  /\bdie\s*(slow|painfully|already)\b/i,
  /\b(loser|idiot|moron|imbecile|scum|vermin|freak)\b/i,
  /\bshame\s*on\s*you\b/i,
  /\byou\s*(deserve|deserved)\s*it\b/i,
];

const HARMFUL_PATTERNS = [
  /\b(i('ll|\s*will|\s*am\s*going\s*to)|gonna)\s*(kill|shoot|stab|bomb|attack|hurt|murder)\b/i,
  /\b(bomb|explosive|grenade)\s*(threat|attack|you|this\s*place)\b/i,
  /\b(shoot|gun|knife)\s*(you|everyone|them|him|her)\b/i,
  /\bself[\s-]?harm\b/i,
  /\bcut\s*(yourself|myself|my\s*wrist)\b/i,
  /\b(suicide|suicidal)\b/i,
  /\bend\s*(my|your|their)\s*life\b/i,
  /\b(buy|sell|deal|score)\s*(drugs|meth|cocaine|heroin|fentanyl)\b/i,
  /\bhow\s*to\s*(make\s*a\s*(bomb|weapon)|buy\s*(guns|drugs))\b/i,
];

function moderateMessage(text) {
  if (leoProfanity.check(text))
    return { blocked: true, reason: 'Message contains profanity or abusive language.' };

  for (const pattern of NEGATIVE_PATTERNS)
    if (pattern.test(text))
      return { blocked: true, reason: 'Message contains hostile or harmful sentiments.' };

  for (const pattern of HARMFUL_PATTERNS)
    if (pattern.test(text))
      return { blocked: true, reason: 'Message contains threatening or harmful content.' };

  return { blocked: false };
}

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json());

// Health check — must be before static middleware
app.get('/healthz', (req, res) => res.sendStatus(200));

app.use(express.static(path.join(__dirname, 'public')));

// ── Routes ───────────────────────────────────────────────────────────────────
app.get('/submit', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'submit.html'));
});

app.get('/qrcode', async (req, res) => {
  try {
    const qr = await QRCode.toDataURL(SUBMIT_URL, {
      width: 400,
      margin: 2,
      color: { dark: '#1a1a2e', light: '#ffffff' },
    });
    res.json({ qr, url: SUBMIT_URL });
  } catch {
    res.status(500).json({ error: 'QR generation failed' });
  }
});

app.get('/messages', (req, res) => {
  res.json(messages);
});

app.post('/message', (req, res) => {
  const text = ((req.body && req.body.text) || '').trim().slice(0, 200);
  if (!text) return res.status(400).json({ error: 'Empty message' });

  const verdict = moderateMessage(text);
  if (verdict.blocked) return res.status(400).json({ error: verdict.reason });

  const msg = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    text,
    timestamp: Date.now(),
  };

  messages.unshift(msg);
  if (messages.length > MAX_MESSAGES) messages = messages.slice(0, MAX_MESSAGES);

  io.emit('new-message', msg);
  res.json({ ok: true });
});

// ── Real-time ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.emit('history', messages);
});

// ── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Listening on port : ${PORT}`);
  console.log(`Wall display      : ${BASE_URL}`);
  console.log(`Submit page       : ${SUBMIT_URL}`);
});
