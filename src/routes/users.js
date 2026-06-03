// ─────────────────────────────────────────────────────────────
//  User management routes (admin only)
//
//  GET    /users          — list all users
//  POST   /users          — create new user
//  PATCH  /users/:id/role — change user role
//  DELETE /users/:id      — delete user
// ─────────────────────────────────────────────────────────────
const express = require('express');
const bcrypt  = require('bcryptjs');
const { authenticate, requireRole } = require('../middleware/auth');
const { getDb } = require('../lib/prisma');

const router = express.Router();

// All user routes — admin only
router.use(authenticate, requireRole('admin'));

// ── GET /users ────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const db    = getDb(req.user.region);
    const users = await db.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id:        true,
        username:  true,
        role:      true,
        createdAt: true,
        lastLogin: true,
      },
    });
    res.json(users);
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// ── POST /users ───────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { username, password, role = 'moderator' } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    if (!['admin', 'moderator', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const db = getDb(req.user.region);

    // Check username not taken
    const existing = await db.user.findUnique({ where: { username } });
    if (existing) return res.status(400).json({ error: 'Username already exists' });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await db.user.create({
      data: { username, passwordHash, role },
      select: { id: true, username: true, role: true, createdAt: true },
    });

    res.json({ ok: true, user });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// ── PATCH /users/:id/role ─────────────────────────────────────
router.patch('/:id/role', async (req, res) => {
  try {
    const { role } = req.body;
    if (!['admin', 'moderator', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    // Prevent admin from changing their own role
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'Cannot change your own role' });
    }

    const db   = getDb(req.user.region);
    const user = await db.user.update({
      where: { id: req.params.id },
      data:  { role },
      select: { id: true, username: true, role: true },
    });

    res.json({ ok: true, user });
  } catch (err) {
    console.error('Update role error:', err);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// ── DELETE /users/:id ─────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    // Prevent admin from deleting themselves
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const db = getDb(req.user.region);
    await db.user.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

module.exports = router;
