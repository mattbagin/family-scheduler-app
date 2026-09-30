-- Milestone 2: ICS calendar subscriptions.

-- If-Modified-Since value, when the last fetch was tried, and why it failed (null = it worked).
ALTER TABLE calendars ADD COLUMN last_modified TEXT;
ALTER TABLE calendars ADD COLUMN last_attempt TEXT;
ALTER TABLE calendars ADD COLUMN last_error TEXT;

-- Who a feed's events are for (e.g. both kids for the school calendar).
-- Replaces calendars.default_member_id, which only allowed one person and is no longer used.
CREATE TABLE calendar_members (
  calendar_id  INTEGER NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  member_id    INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  PRIMARY KEY (calendar_id, member_id)
);

-- Dates cancelled upstream (EXDATE), comma-separated YYYY-MM-DD. Local skips stay in event_exceptions.
ALTER TABLE events ADD COLUMN exdates TEXT;

-- Subscribed events are matched by UID (plus '#date' for a moved single occurrence) on every sync,
-- so the row, and the kids/driver/bring notes set on it here, survive re-syncs.
CREATE UNIQUE INDEX events_ext_uid ON events(calendar_id, ext_uid) WHERE ext_uid IS NOT NULL;
