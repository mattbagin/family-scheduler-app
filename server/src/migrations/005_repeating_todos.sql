-- To-dos that repeat ("Take the bins out every Monday").
-- Ticking one off adds the next as a new to-do; next_id points at it so unticking can take it back.
ALTER TABLE todos ADD COLUMN rrule TEXT;
ALTER TABLE todos ADD COLUMN next_id INTEGER REFERENCES todos(id) ON DELETE SET NULL;
