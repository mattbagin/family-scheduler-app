-- Milestone 3: to-dos and prep items outside of plans.

-- kind 'todo': something to do ("Call the plumber"), optionally by a day.
-- kind 'prep': something to pack or do before a day ("Gym shoes"); always has a day.
-- A removed family member's items become everyone's (assignee_id NULL).
CREATE TABLE todos (
  id           INTEGER PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('todo', 'prep')),
  text         TEXT NOT NULL,
  icon         TEXT NOT NULL,
  assignee_id  INTEGER REFERENCES members(id) ON DELETE SET NULL,
  due          TEXT,
  done_at      TEXT,
  created_at   TEXT NOT NULL,
  CHECK (kind = 'todo' OR due IS NOT NULL)
);
CREATE INDEX todos_due ON todos(due);

-- An event's "bring" note ticked off as packed, per occurrence date.
CREATE TABLE packed (
  event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  packed_at  TEXT NOT NULL,
  PRIMARY KEY (event_id, date)
);
