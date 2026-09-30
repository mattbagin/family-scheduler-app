-- Milestone 4: nudges (reminders, push notifications and hub banners).

-- A browser that agreed to show notifications for a family member.
CREATE TABLE push_subscriptions (
  id          INTEGER PRIMARY KEY,
  member_id   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  label       TEXT,
  created_at  TEXT NOT NULL,
  last_ok_at  TEXT
);

-- Each person's nudge choices (quiet hours, which kinds) as JSON; NULL means the defaults.
ALTER TABLE members ADD COLUMN notify TEXT;

-- "Remind me 15 minutes before": minutes before each occurrence starts.
CREATE TABLE event_reminders (
  event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  offset_min  INTEGER NOT NULL,
  PRIMARY KEY (event_id, offset_min)
);

-- Every nudge that has fired. `key` (e.g. 'leave:12:2026-10-05') makes each fire only once.
-- Times are ISO instants. After expires_at it's no longer shown, sent or escalated.
CREATE TABLE nudges (
  id            INTEGER PRIMARY KEY,
  key           TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  url           TEXT NOT NULL DEFAULT '/',
  audience      TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  acked_at      TEXT,
  acked_by      INTEGER REFERENCES members(id) ON DELETE SET NULL,
  escalation    INTEGER NOT NULL DEFAULT 0,
  last_sent_at  TEXT
);
CREATE INDEX nudges_created ON nudges(created_at);

-- Who each nudge has been pushed to, so quiet hours can hold one back and send it later.
CREATE TABLE nudge_sends (
  nudge_id   INTEGER NOT NULL REFERENCES nudges(id) ON DELETE CASCADE,
  member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  sent_at    TEXT NOT NULL,
  PRIMARY KEY (nudge_id, member_id)
);
