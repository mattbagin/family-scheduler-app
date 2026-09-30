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
0. **Clickable UI mockup** (an HTML artifact) of the hub Today board, kid mode, and the week grid, filled with sample family data. Review and iterate on the look before writing the real app, since the UI matters most.
1. **Foundation:** workspaces scaffold, Fastify + SQLite + migrations, members/auth, local event CRUD, Today board, and week/month views with live WebSocket sync.
2. **Subscriptions:** ICS poller, recurrence expansion, overrides, and the subscription settings UI.
3. **Tasks:** chores, bills, prep items, kid mode, the chore chart with celebrations, and quick add with natural language.
4. **Nudges:** VAPID/Web Push, the nudge scheduler, the hub banner and chime, Tailscale HTTPS setup, and PWA install.
5. **Ambient & polish:** photo slideshow, night dimming, weather, conflict/driver detection, sounds, accessibility pass, and pm2 service + backups.

## 8. Verification
- **Unit tests (Vitest):** recurrence expansion (DST, exdates, overrides), ICS parsing using a real public feed saved as a fixture (e.g. a public holidays calendar), nudge timing math, and natural-language parsing.
- **End-to-end (Playwright, via the `webapp-testing` skill):** add an event with quick add, confirm it appears on the Today board and week grid, complete a chore in kid mode, and check that live sync reaches a second browser tab.
- **Manual:** install the PWA on a phone over Tailscale and receive a leave-by push. Leave the hub on overnight and check that ambient mode and dimming work. Subscribe to a school calendar and edit an upstream event to confirm the change syncs.
