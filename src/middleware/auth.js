// ─────────────────────────────────────────────────────────────
//  Auth middleware
//
//  authenticate      — verifies JWT from cookie or Bearer header
//                      attaches req.user = { id, username, role, region }
//
//  requireRole(...r) — factory that checks req.user.role
//                      usage: requireRole('admin', 'moderator')
//
//  ROLE HIERARCHY:
//    admin     → full access
//    moderator → wall controls + history, no user management
//    viewer    → read-only wall + QR
// ─────────────────────────────────────────────────────────────
const { verifyToken } = require('../lib/jwt');

const ROLE_RANK = { viewer: 0, moderator: 1, admin: 2 };

// Reads token from httpOnly cookie OR Authorization: Bearer <token>
function authenticate(req, res, next) {
  try {
    let token = req.cookies?.access_token;

    if (!token) {
      const header = req.headers.authorization || '';
      if (header.startsWith('Bearer ')) token = header.slice(7);
    }

    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const payload = verifyToken(token);
    req.user   = payload;           // { id, username, role, region }
    req.region = payload.region || 'us';
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// requireRole('moderator') → allows moderator AND admin
// requireRole('admin')     → allows admin only
function requireRole(...roles) {
  const minRank = Math.min(...roles.map(r => ROLE_RANK[r] ?? 99));
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    const userRank = ROLE_RANK[req.user.role] ?? -1;
    if (userRank < minRank) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// Soft auth — attaches user if token present, but does not block
// Used for the wall page (viewers see wall, mods see extra controls)
function softAuthenticate(req, res, next) {
  try {
    let token = req.cookies?.access_token;
    if (!token) {
      const header = req.headers.authorization || '';
      if (header.startsWith('Bearer ')) token = header.slice(7);
    }
    if (token) {
      req.user   = verifyToken(token);
      req.region = req.user.region || 'us';
    }
  } catch {
    // invalid token — treat as unauthenticated viewer
  }
  next();
}

module.exports = { authenticate, requireRole, softAuthenticate };
