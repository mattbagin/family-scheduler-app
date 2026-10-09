-- Which parent unlocked the hub (or a kid's device), so "Got it" on a nudge there can say who answered.
ALTER TABLE sessions ADD COLUMN elevated_by INTEGER REFERENCES members(id) ON DELETE SET NULL;
