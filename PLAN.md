# Family Scheduler: Design & Build Plan

## Context
The family needs one place for everything: school, sports, chores, playdates, bills, and appointments. It should also pull in external calendars (school district, team schedules, Google/Outlook) through ICS subscriptions. Ordinary calendars and to-do lists get ignored, so the core requirement is a UI that people actually look at and interact with. There will be one profile per family member plus a shared **Family** profile on a common tablet or laptop.

**Decisions so far:** web app / installable PWA · self-hosted home server · engagement through an ambient hub display, smart nudges, and a kid-friendly mode · 2 adults + young kids (under about 8, so picture-first for them). `C:\claude-code\family-scheduler` is empty, so this is a new build.

---

## 1. Architecture

```
 Phones (PWA) ─┐                      ┌─ ICS feeds (school, team, Google/Outlook secret URLs)
 Hub tablet ───┼── HTTPS (Tailscale) ─┤
 Laptop ───────┘         │            └─ Open-Meteo weather (no API key)
                  Node server on home PC
                  ├─ REST API + WebSocket (live updates to every screen)
                  ├─ SQLite database (one file, nightly backup)
                  ├─ ICS poller (every 30 min)
                  └─ Nudge scheduler → Web Push + hub banner/chime
```

- **Server:** Node 20 + Fastify, `better-sqlite3`, `ws` for live sync, `node-ical` + `rrule` for feeds and recurrence, `web-push` (VAPID) for notifications, `node-cron` for scheduled jobs.
- **Web:** React + Vite + TypeScript, Tailwind, Framer Motion for animation, `vite-plugin-pwa`, `chrono-node` for natural-language quick-add, `date-fns`.
- **Remote access and HTTPS:** Tailscale on the home PC and each phone, using `tailscale serve` to get a real HTTPS cert. Web Push and PWA install both require HTTPS, and Tailscale provides it without opening router ports. On iOS, push only works after the PWA is added to the home screen (iOS 16.4+).
- **Running it:** use pm2 or NSSM so the server runs as a Windows service and starts on boot. A nightly job copies the SQLite file to a backup folder.
- **Repo layout (npm workspaces):** `server/`, `web/`, and `shared/` (TypeScript types plus recurrence/date helpers used by both sides).

## 2. Profiles & auth
| Profile | Device | Sign-in | Can do |
|---|---|---|---|
| **Family (hub)** | Shared tablet or laptop | Device token, set up once | See everyone. Kids tap their avatar to switch to kid mode. Adults unlock editing with a PIN. |
| **Adult** | Own phone or laptop | Password, then a long-lived session | Everything: add/edit events, manage feeds, bills, chores, reminders |
| **Kid** | Hub (or a kid tablet) | Tap avatar (optional picture PIN) | Kid view: see my day, complete my chores |

Each member has a name, a **color**, an avatar (photo or emoji), a role, and notification preferences.

## 3. Data model (SQLite)
- `members`: id, name, role (adult/kid), color, avatar, pin_hash
- `calendars`: id, name, kind (local/ics), url, color, default_member_id, refresh_min, last_synced, etag
- `events`: id, calendar_id, ext_uid, title, start, end, all_day, rrule, exdates, location, category, notes, travel_min, driver_member_id
- `event_members`: event_id, member_id (who attends)
- `event_overrides`: local annotations on subscribed events, which are read-only upstream (e.g. assign kids, driver, "bring cleats"). Kept in a separate table so re-syncing a feed doesn't wipe them.
- `tasks`: id, kind (chore/todo/bill/prep), title, icon, assignee_id, rrule, due, amount, payee, autopay
- `plans`: id, event_id, title, icon, notes. An event broken into tasks (e.g. Hosting Thanksgiving). Plan tasks are `tasks` rows with `plan_id`, an assignee, and a due date.
- `task_completions`: task_id, occurrence_date, member_id, completed_at
- `reminders`: id, target (event/task), offset_min, audience, escalate_after_min
- `push_subscriptions`, `settings` (home location, quiet hours, hub photo folder)

**Categories** (school, sports, medical, playdate, chores, bills, family, work) each get an icon and accent color. **Person color** is the main visual identity; category shows as an icon. Recurrence is expanded on the fly for the requested date range, in `shared/recurrence.ts`.

## 4. UI design (the core of the app)

**Design principles:** people first, then time (every view answers "who is doing what next"). Glanceable from across the room. Big touch targets. Every action gets immediate feedback through motion. Warm and playful rather than a corporate grid.

### Screens
1. **Hub "Today" board** (Family profile, the default landing screen)
   - Header with a big clock, date, weather, and a "next family thing" countdown.
   - **Person lanes:** one column per member, with avatar and color. Each lane has a *Now/Next* card with a countdown ring ("Soccer in 45 min · Dad driving") and the rest of the day shown as small chips.
   - **Heads-up strip:** leave-by alerts, bills due within 3 days, and "Tomorrow: library books, gym shoes."
   - **Chore chart:** big picture tiles per kid. Tapping one plays a sticker/confetti animation.
   - **Countdown bubbles** for exciting events ("🎂 3 sleeps until Mia's party").
2. **Ambient mode** (the hub after about 2 minutes idle): a photo slideshow from a folder, with a translucent overlay showing the clock and each person's next event. Any touch wakes it. It dims automatically at night, and a banner plus soft chime appears when a nudge fires.
3. **Week "family grid"**: days across and people down, so conflicts and driver gaps are obvious. Drag an event to reschedule it, and tap to see details.
4. **Month view**: a colored dot per person on each day. Tap a day to open its agenda sheet.
5. **Personal phone view (adults):** my agenda, my tasks, bills, and a feed of nudges. Swipe to complete or snooze.
6. **Kid mode:** full screen with a **Now → Next → Later** picture timeline (big icon, image, time shown as a clock face), my chores as sticker tiles, and "sleeps until" countdowns. No text entry and no ability to delete anything.
7. **Quick add** (a floating + button everywhere): type naturally, e.g. "Soccer Tue 5pm Emma weekly at Riverside". It's parsed into a pre-filled card with person-avatar toggles, a category emoji picker, a driver picker, and reminder chips.
8. **Settings:** members, calendar subscriptions (paste an ICS or webcal URL, pick a color and default person, preview upcoming events before saving), notification rules, and hub options.

**Smart helpers shown in the UI:** conflict badges (two events overlap for one person, or two events need a driver at the same time). An "unassigned driver" warning. Travel time turned into a "leave by" time.

## 5. Smart nudges
- **Leave-by:** start minus travel time minus 10 min goes to the attending adults (push) and the hub (banner).
- **Evening prep digest** (7:30 pm): tomorrow's events plus their "bring" notes, pushed to adults and shown on the hub.
- **Morning briefing** (7:00 am): today's summary.
- **Bills:** alerts 3 days before, 1 day before, and on the due day, until marked paid.
- **Escalation:** if a reminder isn't acknowledged within X minutes, it repeats, then notifies the other adult.
- All of these respect per-member quiet hours. The scheduler is in `server/src/nudges/`, and delivery goes through `web-push` plus the WebSocket connection to the hub.

## 6. Calendar subscriptions
- Accept `webcal://` and `https://` ICS URLs, including Google/Outlook "secret address" links.
- Poll every 30 minutes using ETag / If-Modified-Since. Parse with `node-ical`, upsert by `UID` + `RECURRENCE-ID`, and delete events that disappeared upstream.
- Subscribed events are read-only, but local overrides (assigned kids, driver, notes) survive re-syncs.
- *Later:* two-way Google Calendar sync over OAuth. Not needed for v1.

## 7. Milestones
Status as of 2026-09-30: all milestones (0 to 5) are done (✅), with the exceptions noted. §9 has the details.

0. ✅ **Clickable UI mockup** (an HTML artifact) of the hub Today board, kid mode, and the week grid, filled with sample family data. Review and iterate on the look before writing the real app, since the UI matters most. *(Kept in `mockup/homebase-hub.html`.)*
1. ✅ **Foundation:** workspaces scaffold, Fastify + SQLite + migrations, members/auth, local event CRUD, Today board, and week/month views with live WebSocket sync. *(The month view came later, in milestone 5.)*
2. ✅ **Subscriptions:** ICS poller, recurrence expansion, overrides, and the subscription settings UI.
3. ✅ **Tasks:** chores, bills, prep items, kid mode, the chore chart with celebrations, and quick add with natural language.
4. ✅ **Nudges:** VAPID/Web Push, the nudge scheduler, the hub banner and chime, Tailscale HTTPS setup, and PWA install. *(Tailscale is documented in the README, but not yet set up on the home PC; real-phone push is untested. See §9.)*
5. ✅ **Ambient & polish:** photo slideshow, night dimming, weather, conflict/driver detection, sounds, accessibility pass, and pm2 service + backups. *(The service uses Task Scheduler instead of pm2; see §9.)*

## 8. Verification
- **Unit tests (Vitest):** recurrence expansion (DST, exdates, overrides), ICS parsing using a real public feed saved as a fixture (e.g. a public holidays calendar), nudge timing math, and natural-language parsing.
- **End-to-end (Playwright, via the `webapp-testing` skill):** add an event with quick add, confirm it appears on the Today board and week grid, complete a chore in kid mode, and check that live sync reaches a second browser tab.
- **Manual:** install the PWA on a phone over Tailscale and receive a leave-by push. Leave the hub on overnight and check that ambient mode and dimming work. Subscribe to a school calendar and edit an upstream event to confirm the change syncs.

## 9. Progress and hand-off

This section is the current state of the build. Sections 1 to 8 are the original design and are kept as written; where the build differs, it's listed here. `CLAUDE.md` has the coding conventions, and `README.md` is the user guide.

### What's built (by milestone)

| # | Commit | What's in it |
|---|---|---|
| 0 | (before git) | `mockup/homebase-hub.html` |
| 1 | `d7dd70e` | Members and PIN sign-in, hub device with a 10-minute parent unlock, events with repeats and per-occurrence changes (move, skip, other driver), plans with tasks, chores, bills, live sync; Today, Week, person pages, kid mode, ambient screen, Settings; sample family |
| 2 | `d7dd70e` | ICS subscriptions: dependency-free parser (time zones including Outlook's Windows names, EXDATE, RECURRENCE-ID, CANCELLED), extended RRULE (numbered weekdays, BYMONTHDAY, BYMONTH, BYSETPOS), ETag/Last-Modified polling every 30 min, family fields that survive re-syncs, Settings panel with a preview |
| 3 | `9adc291` | To-dos and prep items (`todos` table), "packed" ticks on events' bring notes, chore chart on Today, Get ready lists, swipeable to-do rows, kid-mode packing tiles, all-done celebration, much richer quick-add parser (dates, ranges, lengths, repeats) |
| 4 | `ba14bfd` | Nudges: leave-by with repeat and escalation to the other parent, per-event reminders, morning briefing, evening packing digest, bill alerts; per-parent quiet hours and switches; hub banners with a chime (also over ambient); hand-written Web Push (RFC 8291/8292); service worker, manifest, icons, install button; Tailscale guide in the README |
| 5 | (this commit) | Ambient photo slideshow from a folder on the home computer (recursive, shuffled, preloaded, blurred fill for portrait photos); night mode with its own hours (dim warm clock, no photos, no chimes); weather from Open-Meteo on Today, ambient and a rainy-day heads-up; month view with a day agenda; category picker in quick add; per-device mute and a hub 🔔 switch; accessibility pass (sheet focus trap and return, skip link, labelled groups, hidden decorative emoji, AA contrast fixes, reduced motion); nightly database backups with **Back up now**; Windows background service script |

Since then: repeating to-dos (`todos.rrule`; ticking one off adds the next as a new row, linked by `next_id` so unticking removes it), later folded into chores (§10).

Tests: 77 Vitest tests (shared logic, API, ICS, nudge timing, Web Push against the RFC example, end-to-end nudges through a fake push service, hub settings, photos, weather through a fake Open-Meteo, backups). Each milestone was also checked in a real browser with Playwright (see `CLAUDE.md`).

### Where the build departs from sections 1 to 8

- **Stack:** Node's built-in `node:sqlite` instead of better-sqlite3. Hand-written recurrence, ICS parsing, quick-add parsing and Web Push instead of `rrule`, `node-ical`, `chrono-node` and `web-push`. Plain CSS instead of Tailwind and Framer Motion. No `vite-plugin-pwa`; the service worker is `web/public/sw.js`. No `node-cron`; the server uses timers.
- **Sign-in:** parents use a 4 to 8 digit PIN rather than a password.
- **Data model (§3):**
  - Tasks are four tables, not one `tasks` table: `chores` (+ `chore_completions`), `bills` (+ `bill_payments`), `plan_tasks`, and `todos` (kind `todo` or `prep`).
  - There's no `event_overrides` table: sync only writes the feed's own columns, so family details live on the same event row.
  - `calendar_members` replaces `calendars.default_member_id` (a calendar can be for several people).
  - Reminders are `event_reminders` (minutes before start), and nudges are logged in `nudges` + `nudge_sends`.
- **Hub ambient screen** falls back to gradient scenes when no photo folder is set. Photos are served as they are (no resizing), so very large files load slowly on an old tablet.
- **Running as a service (§1):** Windows Task Scheduler (`scripts/service.ps1`, runs as SYSTEM at startup, restarts itself) instead of pm2 or NSSM, since it needs nothing extra installed. On macOS the same `npm run service` commands use launchd (`scripts/service.sh`, a LaunchDaemon that runs as the installing user); `scripts/service.mjs` picks the script for the platform. Backups are built into the server (`VACUUM INTO`, nightly after 3 AM, keeps 14) rather than a separate job.
- **Hub settings** (photo folder, night mode, weather place and units) are one JSON value in `settings` under the key `hub`. The mute switch is per device (browser storage), not a server setting.

### Not done yet

All planned milestones are built. Ideas for later: leave-by times that clash as a conflict flag, resized photo thumbnails for slow tablets, a time-zone setting, two-way Google Calendar sync (§6).

**Needs a person, not code:**
- [ ] Install Tailscale on the home PC and phones and run `tailscale serve --bg 8080` (README, "Phones and HTTPS").
- [ ] On a phone, install the app, turn on notifications, **Send a test**, then wait for a real leave-by nudge. Web Push has only been tested against a fake push service. Set `HOMEBASE_VAPID_SUBJECT` to a real email first; Apple's push service is untested.
- [ ] Install the background service from an administrator PowerShell (`npm run service -- install`); it has been parse-checked but not installed on the home PC. Then reboot and check that Homebase comes back on its own. On a Mac, run `npm run service -- install` from Terminal; `scripts/service.sh` was only dry-run on Windows with stand-in `launchctl`, `sudo` and `plutil`, so check install, status, stop, restart, a reboot and uninstall on the real Mac.
- [ ] Point Settings → Family hub at a real photo folder and leave the hub on overnight to check the slideshow, night mode and dimming.
- [ ] Check that a nightly backup appears in `server/data/backups` and try a restore once.
- [ ] Subscribe to a real school or team calendar and edit an event upstream to see it sync.

**Known limitations:**
- ICS: extra dates (RDATE) are ignored with a warning. A repeating event whose start is in UTC keeps its local time across daylight-saving changes, where it should shift by an hour. BYWEEKNO and BYYEARDAY rules fall back to the first date.
- Everything uses the home server's time zone; there's no setting for it.
- Push subscriptions belong to a person; the hub itself doesn't get push (it shows banners instead).

## 10. Next: chores on the calendar

**Problem.** Chores are added only in Settings ("Daily jobs"), repeat only on chosen weekdays, have one person each, and show only for today, never on Week or Month. Repeating to-dos (`todos.rrule`) are a second, overlapping way to make things repeat.

**Decided (2026-10-17):**
- Chores stay their own table but repeat like events, with an RRULE. Weekday patterns and monthly patterns are both needed.
- A chore can have several people, and **each does their own**: "Brush teeth" for both kids makes one tile per kid, ticked separately. A chore with nobody on it is a family job: one tick from anyone marks it done.
- Repeating to-dos fold into chores, so to-dos become one-offs only. Repeating **prep** items stay as they are, because they feed Get ready lists and the evening packing digest.

**Steps** (each its own branch from main; see `CLAUDE.md` § Git):

1. ✅ **Server** (`feat/chore-repeats`). Migration `007_chores.sql`:
   - Add `chores.rrule` and `chores.start` (`Ymd`, the anchor date for monthly rules), converting `days` to `FREQ=WEEKLY;BYDAY=…` (`FREQ=DAILY` when all seven days are set).
   - Add `chore_members (chore_id, member_id)`, filled from `assignee_id`.
   - Rebuild `chore_completions` keyed by `(chore_id, member_id, date)`, with `member_id = 0` for family jobs. Existing ticks go to the old assignee.
   - Turn each undone repeating to-do (kind 'todo') into a chore and delete that to-do row. Done rows keep their history but lose their `rrule`.

   API changes:
   - `GET /api/chores?from&to` returns one row per chore, person and date (expand with `expandDates`). `?date=` keeps working.
   - POST and PATCH take `rrule`, `start` and `memberIds`.
   - `PUT /api/chores/:id/done/:date` takes `memberId`, and `requireCanComplete` checks it.
   - `POST /api/todos` rejects `rrule` for kind 'todo'.

   Tests: expansion, per-person ticks, the family-job tick, the migration of old `days` rows and repeating to-dos.
2. ✅ **Adding and editing** (`feat/chore-sheet`):
   - A chore sheet (text, icon, people, repeat preset from `REPEAT_PRESETS` plus monthly), opened from "+ Add a job" on the Today chore chart and person pages, and by tapping a job to edit it.
   - Settings keeps the list but uses the same sheet.
   - Quick add: a to-do with a repeat ("make bed every day for Sam") becomes a chore. The repeat picker leaves the to-do form (it stays for prep).
3. ✅ **Calendar** (`feat/chores-on-calendar`): Week and Month show each day's jobs as small chips (icon + face) under the all-day row. Tapping one ticks it; the Month day sheet lists them. Jobs on later days are view-only, so nobody ticks next Tuesday's garbage early.

**Step 1 as built** (differs from the plan above):
- Reads are split: `GET /api/chores` lists the chores themselves (for Settings), and `GET /api/chores/due?date=` or `?from=&to=` (up to 62 days) returns one row per chore, person and date.
- Ticking a job on a day it isn't due is refused.
- Removing a person deletes the chores that were only theirs; shared ones stay with the others.
- The web side got only what keeps it working: Settings shows each job's repeat and people and can add a family job; Today's chore chart has an **Anyone** row for family jobs; quick add saves a repeating to-do as a chore. The sample family now has a shared “Brush teeth”, a Saturday “Clean my room” and a weekly garbage family job.
- `scripts/check-chores.py` drives the chore chart, kid ticks, quick add and Settings in a browser; extend it in steps 2 and 3.

**Step 2 as built:**
- `web/src/sheets/ChoreSheet.tsx`: text, people (or Anyone), repeat, a **Starts** day, picture. Monthly is two choices made from the start day by `monthlyRules` (shared): the same date (`BYMONTHDAY=18`) or the same weekday (`BYDAY=3SU`; a 5th weekday becomes the last). A rule the sheet can't make is shown as it is and kept on save.
- Tapping a tile still ticks it (kids use the chart), so editing is from the Settings list, where each row opens the sheet; **Remove** is in the sheet. **+ Add a job** is on the Today chart, each person page (with that person picked) and Settings. Today's chart still hides when there are no jobs at all.
- Person pages always show a **Today’s jobs** panel (was “Daily jobs”), with “No jobs today.” when empty.
- Quick add: the repeat picker shows only for packing items; a to-do with a typed repeat shows the repeat read-only and the button says **Add job**.

**Step 3 as built:**
- The Week grid has no all-day row (people are rows), so jobs get their own **Jobs** row under the day headings: one chip per job and person (picture + face; family jobs have no face), green when done. `ChoreChip` lives in `views/Person.tsx` next to `ChoreTile` and uses the same tick, burst and toast.
- Month day cells stay as they were (they're one button, and too small for chips on a phone); the day sheet lists the jobs as chips with their text, tickable the same way.
- Later days' chips are disabled, and the server also refuses ticks for a date after today (`date: this job isn’t due yet…`). Past days can still be ticked.
- `useChores(from, to?)` now takes a range (`/api/chores/due?from&to`); one day by default.
- `scripts/check-chores.py` covers the Week row (per-kid chips, ticking, later days view-only) and the Month day sheet.

**Family jobs in nudges** (`feat/family-job-nudge`): the evening digest starts with “Still to do: …” for today’s family jobs nobody has ticked yet, and goes out for those alone on a day with nothing else to say (“🧹 Still to do tonight: Garbage out”). People’s own jobs stay out; they’re on the chart, and kids don’t get nudges.
