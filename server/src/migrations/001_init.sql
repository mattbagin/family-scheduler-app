CREATE TABLE members (
  id        INTEGER PRIMARY KEY,
  name      TEXT NOT NULL,
  role      TEXT NOT NULL CHECK (role IN ('adult', 'kid')),
  color     TEXT NOT NULL,
  avatar    TEXT NOT NULL,
  pin_hash  TEXT,
  sort      INTEGER NOT NULL DEFAULT 0
);

-- kind 'hub' = the shared family device (no member); elevated_until = adult PIN unlock expiry (ms epoch).
CREATE TABLE sessions (
  token           TEXT PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('member', 'hub')),
  member_id       INTEGER REFERENCES members(id) ON DELETE CASCADE,
  created_at      TEXT NOT NULL,
  elevated_until  INTEGER
);

-- Local calendars and (milestone 2) ICS subscriptions.
CREATE TABLE calendars (
  id                 INTEGER PRIMARY KEY,
  name               TEXT NOT NULL,
  kind               TEXT NOT NULL DEFAULT 'local' CHECK (kind IN ('local', 'ics')),
  url                TEXT,
  color              TEXT,
  default_member_id  INTEGER REFERENCES members(id) ON DELETE SET NULL,
  refresh_min        INTEGER NOT NULL DEFAULT 30,
  last_synced        TEXT,
  etag               TEXT
);

-- start/end are wall-clock 'YYYY-MM-DDTHH:mm' in the family's time zone.
CREATE TABLE events (
  id            INTEGER PRIMARY KEY,
  calendar_id   INTEGER REFERENCES calendars(id) ON DELETE CASCADE,
  ext_uid       TEXT,
  title         TEXT NOT NULL,
  kid_title     TEXT,
  icon          TEXT NOT NULL DEFAULT '📅',
  category      TEXT NOT NULL DEFAULT 'family',
  start         TEXT NOT NULL,
  end           TEXT NOT NULL,
  all_day       INTEGER NOT NULL DEFAULT 0,
  rrule         TEXT,
  location      TEXT,
  notes         TEXT,
  bring         TEXT,
  travel_min    INTEGER NOT NULL DEFAULT 0,
  driver_id     INTEGER REFERENCES members(id) ON DELETE SET NULL,
  needs_driver  INTEGER NOT NULL DEFAULT 0,
  fun           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX events_start ON events(start);
CREATE INDEX events_recurring ON events(rrule) WHERE rrule IS NOT NULL;

CREATE TABLE event_members (
  event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, member_id)
);

-- One-off changes to a single occurrence of a repeating event (moved, cancelled, other driver).
CREATE TABLE event_exceptions (
  event_id       INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  original_date  TEXT NOT NULL,
  patch          TEXT NOT NULL,
  PRIMARY KEY (event_id, original_date)
);

-- An event broken into tasks, e.g. "Hosting Thanksgiving".
CREATE TABLE plans (
  id        INTEGER PRIMARY KEY,
  event_id  INTEGER NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  title     TEXT NOT NULL,
  icon      TEXT NOT NULL,
  notes     TEXT
);

CREATE TABLE plan_tasks (
  id           INTEGER PRIMARY KEY,
  plan_id      INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  text         TEXT NOT NULL,
  icon         TEXT NOT NULL,
  assignee_id  INTEGER REFERENCES members(id) ON DELETE SET NULL,
  due          TEXT NOT NULL,
  done_at      TEXT
);
CREATE INDEX plan_tasks_plan ON plan_tasks(plan_id);

-- days: comma-separated weekdays, 0 = Monday.
CREATE TABLE chores (
  id           INTEGER PRIMARY KEY,
  text         TEXT NOT NULL,
  icon         TEXT NOT NULL,
  assignee_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  days         TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6',
  sort         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE chore_completions (
  chore_id      INTEGER NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
  date          TEXT NOT NULL,
  completed_at  TEXT NOT NULL,
  PRIMARY KEY (chore_id, date)
);

-- A monthly bill rolls its due date forward when paid; bill_payments keeps the history.
CREATE TABLE bills (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  icon          TEXT NOT NULL DEFAULT '💵',
  amount_cents  INTEGER NOT NULL,
  due           TEXT NOT NULL,
  monthly       INTEGER NOT NULL DEFAULT 0,
  autopay       INTEGER NOT NULL DEFAULT 0,
  paid_at       TEXT
);

CREATE TABLE bill_payments (
  id        INTEGER PRIMARY KEY,
  bill_id   INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  due       TEXT NOT NULL,
  paid_at   TEXT NOT NULL
);

CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
