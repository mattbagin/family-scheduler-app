-- Where each person usually is ("At school" Mon–Fri 08:30–15:15): a JSON list of DailyStatus.
ALTER TABLE members ADD COLUMN statuses TEXT NOT NULL DEFAULT '[]';
-- A calendar of days off (public holidays): its all-day events pause everyone's statuses.
ALTER TABLE calendars ADD COLUMN days_off INTEGER NOT NULL DEFAULT 0;
