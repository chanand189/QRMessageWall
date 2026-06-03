-- ─────────────────────────────────────────────────────────────
--  QR Message Wall — Phase 1 Migration
--  Run this in: Supabase → SQL Editor → New Query
-- ─────────────────────────────────────────────────────────────

-- ENUMS
CREATE TYPE "Role"        AS ENUM ('admin', 'moderator', 'viewer');
CREATE TYPE "EventType"   AS ENUM ('birthday', 'wedding', 'survey', 'other');
CREATE TYPE "EventStatus" AS ENUM ('draft', 'live', 'ended');
CREATE TYPE "PhotoStatus" AS ENUM ('queued', 'displaying', 'displayed');
CREATE TYPE "ActionType"  AS ENUM ('refresh', 'trim', 'delete', 'slide', 'event_start', 'event_end');

-- USERS
CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username       TEXT UNIQUE NOT NULL,
  "passwordHash" TEXT NOT NULL,
  role           "Role" NOT NULL DEFAULT 'viewer',
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "lastLogin"    TIMESTAMPTZ
);

-- EVENTS
CREATE TABLE events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  type          "EventType" NOT NULL DEFAULT 'other',
  status        "EventStatus" NOT NULL DEFAULT 'draft',
  "qrCodeUrl"   TEXT,
  "submitUrl"   TEXT,
  "createdById" UUID NOT NULL REFERENCES users(id),
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "startedAt"   TIMESTAMPTZ,
  "endedAt"     TIMESTAMPTZ,
  "wallLimit"   INT NOT NULL DEFAULT 20,
  "autoSlide"   BOOLEAN NOT NULL DEFAULT TRUE
);

-- MESSAGES
CREATE TABLE messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content       TEXT NOT NULL,
  "ipHash"      TEXT,
  "eventId"     UUID NOT NULL REFERENCES events(id),
  "isVisible"   BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deletedById" UUID REFERENCES users(id),
  "deletedAt"   TIMESTAMPTZ
);

CREATE INDEX idx_messages_event_visible ON messages("eventId", "isVisible");
CREATE INDEX idx_messages_event_created ON messages("eventId", "createdAt");

-- PHOTO QUEUE
CREATE TABLE photo_queue (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caption        TEXT,
  "storageUrl"   TEXT NOT NULL,
  "storageKey"   TEXT NOT NULL,
  status         "PhotoStatus" NOT NULL DEFAULT 'queued',
  "durationSec"  INT NOT NULL DEFAULT 4,
  "submittedBy"  TEXT,
  "ipHash"       TEXT,
  "eventId"      UUID NOT NULL REFERENCES events(id),
  "submittedAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "displayedAt"  TIMESTAMPTZ
);

CREATE INDEX idx_photo_event_status ON photo_queue("eventId", status);

-- WALL ACTIONS (audit log)
CREATE TABLE wall_actions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            "ActionType" NOT NULL,
  detail          JSONB,
  "performedById" UUID NOT NULL REFERENCES users(id),
  "eventId"       UUID NOT NULL REFERENCES events(id),
  "performedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wall_actions_event ON wall_actions("eventId", "performedAt");

-- ─────────────────────────────────────────────────────────────
--  SEED: default admin user
--  Password: Admin@1234  (change immediately after first login)
--  Hash generated with bcrypt rounds=12
-- ─────────────────────────────────────────────────────────────
INSERT INTO users (username, "passwordHash", role)
VALUES (
  'admin',
  '$2b$12$KIXMnMWvHU5r8pUFIjMsOOqkzHmFwE9YkQJHCqrp8OmKkBaE8DTdm',
  'admin'
);
