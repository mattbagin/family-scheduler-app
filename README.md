# Homebase

A family schedule hub: one calendar for school, sports, playdates, appointments, chores and bills, with plans that break big events into tasks. It runs on a home computer and every device in the house (the shared kitchen tablet, laptops, phones) opens it in a browser.

## Run it

Requires Node 22.18 or newer (uses the built-in `node:sqlite` and TypeScript type stripping).

```sh
npm install
npm run build     # build the web app into web/dist
npm start         # serve everything on http://localhost:8080
```

On first launch, set up your family, or pick **Try it with a sample family** (both sample parents' PIN is `1234`).

For development, `npm run dev` runs the API on :8080 and Vite on http://localhost:5173 with hot reload.

| Setting | Default |
|---|---|
| `PORT` | `8080` |
| `HOST` | `0.0.0.0` (reachable from other devices on the network) |
| `HOMEBASE_DB` | `server/data/homebase.db` |

## How sign-in works

- **Parents** sign in with a 4–8 digit PIN and can change everything.
- **Kids** tap their face. They can see everything and tick off their own jobs.
- **Family hub** is for the shared tablet. A parent sets it up once with their PIN. Anyone can use it to view and tick off jobs, and a parent's PIN unlocks editing for 10 minutes.

Every change is pushed live to every open screen.

## Calendar subscriptions

In **Settings → Subscribed calendars**, paste an ICS or `webcal://` link: a school or team calendar, or the "secret address" of a Google or Outlook calendar. Homebase shows what's in the link before you subscribe. Pick whose calendar it is, and new events from it go to those people.

- Each calendar refreshes every 30 minutes, or right away with **Refresh**. Changes, cancellations and deletions made upstream show up here.
- The name, time and place of a subscribed event come from its calendar and can't be changed in Homebase. You can still set who's going, who's driving, the drive time, what to bring, the picture and the kid-mode name, and those survive every refresh. You can also skip a single occurrence.
- Events use the home server's time zone. Feeds in other zones (including Outlook's Windows zone names) are converted.

## Layout

```
shared/   types and logic used by both sides: dates, repeat rules, quick-add parser, conflict checks
server/   Fastify API + SQLite (migrations in server/src/migrations), live updates over WebSocket
web/      React app (Vite): Today, Week, person pages, kid mode, ambient screen, settings
mockup/   the original clickable design mockup
```

## Checks

```sh
npm test          # shared logic + API tests (Vitest)
npm run typecheck
```

## Roadmap

1. ~~Foundation: members and PINs, events with repeats, plans with tasks, chores, bills, live sync~~
2. ~~Calendar subscriptions (school, team, Google/Outlook ICS links)~~
3. Richer tasks and kid-mode polish
4. Nudges: push notifications (leave-by, pack for tomorrow, bills), HTTPS over Tailscale, installable app
5. Ambient photo slideshow, weather, backups, running as a Windows service
