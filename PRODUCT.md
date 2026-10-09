# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One family, and only this family: two parents and young kids (under about 8). Nobody else installs or runs it.

- **Parents** use their phones and laptops to plan the week: add and edit events, assign drivers, manage chores, bills, to-dos and calendar subscriptions. They also get nudges (time to leave, bills, packing) as push notifications.
- **Kids** use the shared kitchen tablet. They tap their face to see their day and tick off their own jobs. Most can't read yet.
- **The family hub** is that shared tablet, on all day. Anyone in the house looks at it in passing, and it switches to an ambient photo screen when nobody's using it.

The hub and the parents' phones carry equal weight. When a design choice favors one, it must not break the other.

## Product Purpose

Homebase puts the whole family's life in one place: school, sports, playdates, appointments, chores, bills, to-dos and packing, plus external calendars pulled in over ICS. Ordinary calendars and to-do lists get ignored, so it only works if people actually look at it and use it. Success means the family checks it without being asked, the kids finish their jobs from it, and nobody misses a pickup, a bill or a "bring your gym shoes".

## Positioning

A self-hosted hub built around people rather than calendars. Every view answers "who is doing what next". The home computer runs it and the whole family shares it: a hub people glance at, nudges for the parents, and a picture-first mode the kids can use without reading.

## Operating Context

- **Hub:** a tablet in the kitchen, read from across the room and touched by small hands. Today board (person lanes, chore chart, heads-up strip, countdowns), Week grid, Month view, and an ambient slideshow after two idle minutes. Night mode dims it and silences chimes.
- **Phones:** installed as a PWA over Tailscale HTTPS. Personal agenda, to-dos (swipe to finish or push to tomorrow), nudge feed, quick add.
- **Kid mode:** a Now → Next → Later picture timeline, job tiles with celebrations, "sleeps until" countdowns. No typing and no deleting.
- **Rituals:** 7:00 AM morning briefing, 7:30 PM evening packing digest, leave-by nudges that escalate to the other parent when nobody taps **Got it**.
- Editing on the hub needs a parent PIN (unlocked for 10 minutes). Kids can tick off only their own jobs.

## Capabilities and Constraints

- Self-hosted on a home computer (Windows, or macOS via launchd). Node with SQLite in one file and nightly backups. No cloud services except Open-Meteo weather and the browsers' push services.
- Live sync over a websocket: a change on one screen shows up on every other screen.
- Subscribed calendars are read-only upstream. The family's own details (who goes, driver, what to bring) survive re-syncs.
- Few dependencies on purpose. The web app is React + Vite with plain CSS and CSS variables, and no UI or animation libraries.
- Times are the home server's local time. There's no time-zone setting.
- Terms: "jobs" (daily chores for kids), "to-dos", "prep"/"packing" (what to bring), "plans" (a big event broken into tasks), "nudges", "the hub", "kid mode", "quick add".

## Brand Commitments

- Name: **Homebase**.
- Voice: plain, warm and short. Written for parents and read aloud to kids. Curly quotes and apostrophes (’ “ ”). Error messages say what to do next.
- Each person's color is the main visual identity. Event categories (school, sports, medical, playdate, chores, bills, family, work) show as icons.
- Warm and playful rather than a corporate grid. Every action gets immediate feedback.

## Evidence on Hand

- `mockup/homebase-hub.html`: the original clickable mockup (hub Today, kid mode, week grid).
- The sample family set up by "Try it with a sample family" (`server/src/seed.ts`). It's demo data, not real people.
- `server/test/fixtures/us-holidays.ics`: a real public Google holiday feed.
- No real family photos, logos or testimonials are in the repo. Don't make any up.

## Product Principles

1. **People first, then time.** Every screen answers who is doing what next.
2. **Glance, don't study.** The hub reads from across the room. Phones get to the point in one look.
3. **Kids are real users.** Anything a kid touches works without reading and can't destroy anything.
4. **Nudge, don't nag.** Respect quiet hours and night mode. Escalate only what matters.
5. **Ours, at home.** Self-hosted, few dependencies, built for one family rather than a market.

## Accessibility & Inclusion

- WCAG AA contrast, focus management in sheets, honoring reduced motion (all done in milestone 5).
- **Pre-readers:** kid-facing surfaces (kid mode, job tiles, packing tiles) carry their meaning through pictures, icons, faces and color. Text is never the only cue.
- Big touch targets on the hub for small hands.
