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
| `HOMEBASE_VAPID_SUBJECT` | `mailto:homebase@example.com` (a contact for the push services; use a real email of yours) |
| `HOMEBASE_BACKUP_DIR` | `backups` next to the database |
| `HOMEBASE_BACKUP_KEEP` | `14` (nightly backups to keep) |

## How sign-in works

- **Parents** sign in with a 4–8 digit PIN and can change everything.
- **Kids** tap their face. They can see everything and tick off their own jobs.
- **Family hub** is for the shared tablet. A parent sets it up once with their PIN. Anyone can use it to view and tick off jobs, and a parent's PIN unlocks editing for 10 minutes.

Every change is pushed live to every open screen.

## Jobs, to-dos and packing

- **Daily jobs** (Settings) show as picture tiles on the Today board, each kid's page and in kid mode. Finishing the last one gets a big celebration.
- **To-dos** ("Call the plumber Friday Dad") live on each person's page. On a phone, swipe right to finish one or left to push it to tomorrow; the buttons do the same. A to-do can repeat (“Wash the car every Saturday”, or pick **Repeats** in quick add): ticking it off adds the next one, and unticking takes it back.
- **Packing:** an event's "what to bring" note and prep items ("Pack gym shoes Thursday Emma") make a Get ready checklist for today and tomorrow. Today's items drop off once their event starts.
- **Quick add (+)** understands plain words: days ("Oct 12", "10/12", "the 15th", "in 2 weeks"), times and ranges ("5-6:30pm", "at noon for 45 min"), repeats ("every Tue and Thu", "every other Saturday", "weekdays") and "all day". An event with no time can be saved as a to-do instead.

## Nudges

Homebase nudges the parents so things don't slip:

- **Time to leave:** the start time minus the drive time minus 10 minutes, sent to whoever is driving. If nobody taps **Got it**, it repeats after 10 minutes and then goes to the other parent.
- **Reminders** set on an event ("15 min before", "the day before").
- **Morning briefing** (7:00 AM): what's on today and what to bring.
- **Evening packing** (7:30 PM): what's on tomorrow and what to pack tonight.
- **Bills:** 3 days before, the day before and on the day, then daily until marked paid (not for autopay).

Nudges show as banners with a soft chime on the family hub, even over the ambient screen, and go to parents' phones as notifications. Each parent sets their own quiet hours (9:30 PM to 6:30 AM by default) and which kinds they want in **Settings → Nudges**. Nudges held back by quiet hours go out when those hours end, if they still matter.

## The family hub screen

The shared tablet shows **Today**, **Week** and **Month** (a colored dot for each person busy that day; tap a day for its list). After two minutes without a touch it switches to the **ambient screen**: a slideshow with the clock, the weather and everyone’s next thing. Any tap wakes it. Set it up in **Settings → Family hub**:

- **Photos:** paste the full path of a folder on the home computer, like `C:\Users\you\Pictures\Family` on Windows or `/Users/you/Homebase Photos` on a Mac. Pictures in folders inside it count too (JPEG, PNG, WebP, GIF, AVIF). Photos are shuffled, and portrait ones are shown whole over a blurred copy. Without a folder, the slideshow uses color scenes.
- **Night mode** (9 PM to 6:30 AM unless you change it): photos give way to a dim, warm clock, and the hub stops chiming.
- **Weather:** search for your town. The forecast comes from [Open-Meteo](https://open-meteo.com) (free, no account) and shows on the Today board and the ambient screen. A rainy day adds an umbrella heads-up.
- **Sounds:** the 🔔 button on the hub’s top bar mutes its chimes. Any device can turn its own sounds off in **Settings → This device**.

## Running it all the time

Homebase can start with the computer, before anyone signs in, and come back if it ever stops. The same commands work on Windows and macOS: `npm run service -- status` says whether it’s running, `stop` stops it, `restart` picks up changes after `git pull` and `npm run build`, and `uninstall` removes it (your data stays). Settings such as `PORT` or `HOMEBASE_VAPID_SUBJECT` that are set in the window when you install are remembered; to change them later, set them and install again.

### Windows

Open PowerShell **as administrator** in the Homebase folder and run:

```powershell
npm install
npm run build
npm run service -- install
```

This uses Windows’ built-in Task Scheduler (no extra software). Run the other `npm run service` commands from an administrator PowerShell too. The log is `server\data\homebase.log`. Keep the computer from sleeping (Settings → System → Power) so the hub and nudges keep working.

### macOS

Open Terminal in the Homebase folder and run (without `sudo`; it asks for your password when it needs it):

```sh
npm install
npm run build
npm run service -- install
```

This uses macOS’s built-in launchd (no extra software). Homebase runs as the account that installed it. The log is `server/data/homebase.log`. A few Mac settings to check:

- **Sleep:** in System Settings → Energy (or Battery → Options on a laptop), turn on **Prevent automatic sleeping when the display is off**, so the hub and nudges keep working.
- **Firewall:** if macOS asks whether `node` may accept incoming connections, choose **Allow**, or the tablet and phones can’t reach it.
- **Photos:** the background service isn’t allowed into your Pictures, Documents or Desktop folders. Keep the hub’s photos in a folder of their own, like `/Users/you/Homebase Photos`, or give `node` **Full Disk Access** in System Settings → Privacy & Security. Export pictures out of the Photos app as JPEG; iPhone HEIC photos don’t show in the slideshow.

## Backups

Every night after 3 AM (or when the computer next wakes), Homebase copies its database to `server/data/backups/homebase-<date>-<time>.db` and keeps the last 14. **Settings → Backups** shows the latest one and has a **Back up now** button. For safety against a failed disk, point `HOMEBASE_BACKUP_DIR` at a synced folder (OneDrive, iCloud Drive, Dropbox) or another drive.

To restore: stop Homebase (`npm run service -- stop`, or close `npm start`), copy the backup over `server/data/homebase.db`, delete any `homebase.db-wal` and `homebase.db-shm` files next to it, then start it again (`npm run service -- restart`).

## Making and deploying changes

Changes are made on a development computer and released to the home computer by version tag.

1. On the development computer, make a branch (`git switch -c fix/short-name`), commit, push it and open a pull request into `main`. GitHub runs the checks (typecheck, tests, build); merge when they pass.
2. Release: on `main`, tag the next version and push it, e.g. `git tag v1.0.1 && git push origin v1.0.1`.
3. On the home computer, press **Settings → Backups → Back up now**, then:

   ```sh
   git fetch --tags
   git checkout v1.0.1
   npm ci
   npm run build
   npm run service -- restart
   ```

To roll back, check out the previous tag and repeat the same steps. If the release added a database change (a new file in `server/src/migrations/`), the older version won't understand the newer database: restore the backup you made before deploying (see Backups).

## Phones and HTTPS (Tailscale)

Phones need Homebase's secure `https://` address to install it and get notifications. [Tailscale](https://tailscale.com) provides one without opening any ports on your router:

1. Install Tailscale on the home computer and sign in. Install the Tailscale app on each parent's phone with the same account.
2. In the Tailscale admin console, under **DNS**, turn on **MagicDNS** and **HTTPS Certificates**.
3. On the home computer, run `tailscale serve --bg 8080`. Homebase is now at `https://<computer-name>.<your-tailnet>.ts.net`, and this setting survives restarts.
4. On each phone, open that address and sign in:
   - **Android (Chrome):** menu → **Install app**.
   - **iPhone (iOS 16.4 or newer):** Share → **Add to Home Screen**, then open Homebase from the home screen. iPhones only allow notifications for installed apps.
5. In Homebase, go to **Settings → Nudges → Turn on notifications**, then **Send a test**.

Optional: with Tailscale in front, set `HOST=127.0.0.1` so Homebase is reachable only through Tailscale and not from other devices on the home Wi-Fi.

## Calendar subscriptions

In **Settings → Subscribed calendars**, paste an ICS or `webcal://` link: a school or team calendar, or the "secret address" of a Google or Outlook calendar. Homebase shows what's in the link before you subscribe. Pick whose calendar it is, and new events from it go to those people.

- Each calendar refreshes every 30 minutes, or right away with **Refresh**. Changes, cancellations and deletions made upstream show up here.
- The name, time and place of a subscribed event come from its calendar and can't be changed in Homebase. You can still set who's going, who's driving, the drive time, what to bring, the picture and the kid-mode name, and those survive every refresh. You can also skip a single occurrence.
- Events use the home server's time zone. Feeds in other zones (including Outlook's Windows zone names) are converted.

## Layout

```
shared/   types and logic used by both sides: dates, repeat rules, quick-add parser, conflict checks
server/   Fastify API + SQLite (migrations in server/src/migrations), live updates over WebSocket
web/      React app (Vite): Today, Week, Month, person pages, kid mode, ambient screen, settings
scripts/  run Homebase as a background service (Task Scheduler on Windows, launchd on macOS)
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
3. ~~Richer tasks and kid-mode polish~~
4. ~~Nudges: push notifications (leave-by, pack for tomorrow, bills), HTTPS over Tailscale, installable app~~
5. ~~Ambient photo slideshow, night mode, weather, month view, accessibility, backups, running as a Windows service~~
