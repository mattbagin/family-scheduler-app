-- Chores repeat like events (an RRULE from a start day) and can be for several people, each ticking their own.
-- A chore with nobody on it is a family job: one tick from anyone does it (member_id 0 in chore_completions).
-- Repeating to-dos move over here; to-dos become one-offs (repeating prep items stay in todos).

CREATE TABLE chores_new (
  id     INTEGER PRIMARY KEY,
  text   TEXT NOT NULL,
  icon   TEXT NOT NULL,
  rrule  TEXT NOT NULL,
  start  TEXT NOT NULL,
  sort   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE chore_members (
  chore_id   INTEGER NOT NULL REFERENCES chores_new(id) ON DELETE CASCADE,
  member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  PRIMARY KEY (chore_id, member_id)
);

CREATE TABLE chore_completions_new (
  chore_id      INTEGER NOT NULL REFERENCES chores_new(id) ON DELETE CASCADE,
  member_id     INTEGER NOT NULL,
  date          TEXT NOT NULL,
  completed_at  TEXT NOT NULL,
  PRIMARY KEY (chore_id, member_id, date)
);

-- days '0,2,4' becomes BYDAY=MO,WE,FR (digits and day codes don't overlap, so the replaces can't collide).
INSERT INTO chores_new (id, text, icon, rrule, start, sort)
SELECT id, text, icon,
  CASE WHEN days = '0,1,2,3,4,5,6' THEN 'FREQ=DAILY'
       ELSE 'FREQ=WEEKLY;BYDAY=' || replace(replace(replace(replace(replace(replace(replace(days,
         '0', 'MO'), '1', 'TU'), '2', 'WE'), '3', 'TH'), '4', 'FR'), '5', 'SA'), '6', 'SU') END,
  coalesce((SELECT min(date) FROM chore_completions WHERE chore_id = chores.id), date('now', 'localtime')),
  sort
FROM chores;

INSERT INTO chore_members (chore_id, member_id) SELECT id, assignee_id FROM chores;

INSERT INTO chore_completions_new (chore_id, member_id, date, completed_at)
SELECT cc.chore_id, c.assignee_id, cc.date, cc.completed_at FROM chore_completions cc JOIN chores c ON c.id = cc.chore_id;

-- Open repeating to-dos become chores. Ids are offset past the existing chores so chore_members can follow.
INSERT INTO chores_new (id, text, icon, rrule, start, sort)
SELECT (SELECT coalesce(max(id), 0) FROM chores) + t.id, t.text, t.icon, t.rrule, t.due, 1000
FROM todos t WHERE t.kind = 'todo' AND t.rrule IS NOT NULL AND t.done_at IS NULL AND t.due IS NOT NULL;

INSERT INTO chore_members (chore_id, member_id)
SELECT (SELECT coalesce(max(id), 0) FROM chores) + t.id, t.assignee_id
FROM todos t WHERE t.kind = 'todo' AND t.rrule IS NOT NULL AND t.done_at IS NULL AND t.due IS NOT NULL AND t.assignee_id IS NOT NULL;

DELETE FROM todos WHERE kind = 'todo' AND rrule IS NOT NULL AND done_at IS NULL AND due IS NOT NULL;
UPDATE todos SET rrule = NULL, next_id = NULL WHERE kind = 'todo';

DROP TABLE chore_completions;
DROP TABLE chores;
-- Renaming rewrites the references in chore_members and chore_completions_new.
ALTER TABLE chores_new RENAME TO chores;
ALTER TABLE chore_completions_new RENAME TO chore_completions;
