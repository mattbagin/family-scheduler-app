# Homebase (family scheduler)

A self-hosted family calendar hub: shared tablet "hub", parents' phones, and a picture-first kid mode. `PLAN.md` is the design doc and milestone list; `README.md` is the user-facing guide. **Start with `PLAN.md` §9**: it has what's built (all milestones), what needs a person rather than code, and where the build departs from the original design.

## Commands

```sh
npm install
npm test            # Vitest: shared/test and server/test
npm run typecheck   # tsc for shared, server, web (all noEmit)
npm run dev         # API on :8080 + Vite on :5173 (proxies /api and the websocket)
npm run build       # web -> web/dist; `npm start` then serves everything on :8080
```

Run a single test file with `npx vitest run server/test/calendars.test.ts`. Before calling work done, run both `npm test` and `npm run typecheck`.

## Stack and constraints

- **Node ≥ 22.18, no build step for the server.** Node runs `.ts` directly through type stripping, so:
  - relative imports must include the `.ts` extension (`import { x } from './db.ts'`);
  - only erasable TypeScript is allowed (`erasableSyntaxOnly`): no `enum`, no `namespace`, no constructor parameter properties;
  - use `import type` for type-only imports (`verbatimModuleSyntax`).
- **Database:** built-in `node:sqlite` (`DatabaseSync`), not better-sqlite3. Use the helpers in `server/src/db.ts` (`all`, `get`, `run`, `tx`). `tx` nests via savepoints.
- **Few dependencies, on purpose.** Recurrence, ICS parsing, validation and time-zone math are hand-written; add a package only when that clearly beats a small amount of code. `PLAN.md` names some libraries (better-sqlite3, rrule, node-ical, Tailwind, Framer Motion) that the build deliberately does not use.
- **Web:** React 19 + Vite + TanStack Query + react-router. Plain CSS in `web/src/styles.css` with CSS variables (`--pc` is the person color, set with `pc()` from `ui.tsx`). Shared code is imported as `@shared` in web and by relative path (`../../shared/src/index.ts`) in server.

## Layout

```
shared/src/   types.ts (API shapes), time.ts, recurrence.ts (RRULE parse/expand), flags.ts (conflicts), quickadd.ts, icons.ts, weather.ts (WMO codes)
server/src/   app.ts (Fastify wiring), db.ts + migrations/NNN_*.sql, repo.ts (row -> API mapping, reads),
              http.ts (validators v.*, parseBody/parsePatch, HttpError), auth.ts, live.ts (websocket broadcast),
              routes/*.ts, ics/ (feed parser, zones, sync + poller), nudges/ (plan, nudger, webpush), seed.ts (sample family),
              hub.ts (hub settings, photo folder, Open-Meteo weather), backup.ts (nightly VACUUM INTO)
web/src/      App.tsx (shell/routes), api.ts, queries.ts (queries + live sync), context.tsx (useFamily/useAction/useNow),
              ui.tsx (Sheet, Face, ConfirmButton, confetti, celebrate), todos.tsx (to-do/prep rows, swipe, toggles),
              nudges.tsx (banners, feed), push.ts (notifications + install), hub.tsx (useNight, WeatherNow), views/*, sheets/*
web/public/   sw.js (service worker: push, notification clicks), manifest and icons
scripts/      service.mjs picks the platform's script for `npm run service`: service.ps1 + run.ps1 (Windows Task Scheduler; ASCII only,
              Windows PowerShell 5.1 reads them) or service.sh + run.sh (macOS launchd; macOS's /bin/bash is 3.2, so no bash 4+ features)
```

## Conventions that aren't obvious from one file

- **Times are wall-clock strings, never `Date`s:** `Ymd` = `YYYY-MM-DD`, `LocalDateTime` = `YYYY-MM-DDTHH:mm` in the family's (server's) time zone. Use the helpers in `shared/src/time.ts`. All-day events run from `dayT00:00` to `nextDayT00:00` (end is exclusive).
- **Weekdays are 0 = Monday … 6 = Sunday** everywhere (chores, RRULE `byDay`, `weekdayMon`).
- **Recurring events are expanded on read** (`occurrencesBetween` in repo.ts → `expandEvent`). Per-date local changes live in `event_exceptions`; dates cancelled upstream live in `events.exdates`.
- **Schema changes go in a new numbered file** in `server/src/migrations/`. Never edit an applied migration. Migrations run automatically on startup.
- **Every mutating route calls `changed(...topics)`** so the websocket tells other screens what to refetch. A new topic needs adding to `LiveTopic` (shared/types.ts) and `TOPIC_KEYS` (web/queries.ts).
- **Auth levels:** `requireAuth` (anyone signed in), `requireEditor` (a parent, or the hub/kid device unlocked with a parent PIN for 10 minutes), `requireCanComplete` (kids may tick off only their own jobs).
- **Validation:** request bodies go through `parseBody` / `parsePatch` with `v.*` checkers. Errors read `field: problem`, for example `title: must be non-empty text`.
- **Four kinds of "task", four tables:** `chores` (repeat by weekday, ticked per date in `chore_completions`), `bills`, `plan_tasks` (inside a plan) and `todos` (`kind` 'todo' or 'prep'). An event's `bring` note ticked as packed lives in `packed` (per event and date). `GET /api/prep` merges bring notes and prep todos into one list.
- **Nudges:** `nudges/plan.ts` is a pure function (now + data → what's due); `nudger.ts` records each nudge once by `key`, pushes it per person (skipping, not dropping, during quiet hours), and escalates urgent ones that nobody acknowledges. The server ticks every 30 s (`runNudges`); tests call `app.nudger.tick(date)` instead. Web Push encryption and VAPID are hand-written in `nudges/webpush.ts` and checked against RFC 8291's example; don't swap in a library without a reason.
- **Subscribed (ICS) events:** sync writes only the feed's fields (title, start/end, all-day, rrule, exdates, location, notes). The family's fields (members, driver, needsDriver, travelMin, bring, kidTitle, icon, category, fun) sit on the same row and survive re-syncs, because rows are matched by `(calendar_id, ext_uid)`. The API returns 409 `read_only` for edits to feed fields, deleting a feed event, or moving an occurrence of one.
- **UI copy** is plain, warm and short, written for parents and read aloud to kids. It uses curly quotes and apostrophes (’ “ ”), and error messages say what to do next.
- **Hub:** photo folder, night mode and weather place live in one `settings` row (`hub`, JSON) behind `/api/hub-settings` (topic `hub`). Weather is fetched and cached server-side (`createWeather`), so every screen shares one request; tests pass `weatherApi` to point at a fake. Photos are served only from inside the chosen folder (`photoFile` checks the resolved path). `chime()` is silent when the device is muted (`setMuted`, browser storage) or the hub is in night mode (`setHushed`).
- **Sheets** manage focus: `Sheet` moves focus in and traps Tab, and `SheetProvider` returns focus to whatever opened it. Decorative emoji next to text get `aria-hidden`.
- **Tests:** API tests use `buildApp({ db: openDb(':memory:') })` + `app.inject`. The helpers are in `server/test/helpers.ts`. Feed tests run a local `node:http` server; fixtures are in `server/test/fixtures/` (`us-holidays.ics` is a real Google public feed). Nudge tests run a fake push service that decrypts messages like a phone would. Background work is off in tests (`pollFeeds`, `runNudges` default to false; `backup` is omitted).

## Checking the real app in a browser

Unit tests don't prove the UI works, so each milestone was also driven with Playwright (Python, through the `webapp-testing` skill). The scripts are throwaway and not in the repo. What works on this machine:

1. `npm run build`, then start the server on a throwaway database in the background: `PORT=8090 HOMEBASE_DB=<scratch>/e2e.db node --disable-warning=ExperimentalWarning server/src/index.ts`. Use a new file name for each run, because the sample family can only be set up once per database.
2. In the script, go to `http://localhost:8090`, click "Try it with a sample family" (both parents' PIN is `1234`), and drive the UI. Log in a hub with `context.request.post('/api/login', data={memberId, pin, asHub: True})`.
3. Stop the server afterwards (PowerShell: `Get-NetTCPConnection -LocalPort 8090 -State Listen | % { Stop-Process -Id $_.OwningProcess }`).

Gotchas: the skill's `with_server.py` runs commands through `cmd`, so `VAR=value` prefixes fail; start the server yourself instead. Headless Chromium always reports notifications as blocked. Set `PYTHONIOENCODING=utf-8` when printing emoji on Windows. Nudges fire on the server's 30-second tick, so allow about 45 s for a banner.

## Environment notes

- Developed on Windows 11. Paths in the repo use forward slashes. The SQLite file defaults to `server/data/homebase.db` (git-ignored).
- The "SQLite is an experimental feature" warning from Node is expected and harmless.
- In the Bash tool, long heredocs containing mixed quotes and backticks sometimes fail to parse. Write multi-line edit scripts to a file in the scratchpad and run them from there.

## Git

- The remote is `origin` (https://github.com/mattbagin/family-scheduler-app). `main` is protected: work on a branch (`fix/…`, `feat/…`, `chore/…`), push it and open a pull request; CI (`.github/workflows/ci.yml`) must pass before merging. Releases are tags `vX.Y.Z` on `main`; the home computer (a separate machine) deploys a tag as described in README, "Making and deploying changes". This machine is development only.
- Commit or push only when asked. `.claude/settings.local.json` is personal and git-ignored; line endings are LF (`.gitattributes`).
