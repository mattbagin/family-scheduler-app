import { existsSync } from 'node:fs';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyError } from 'fastify';
import type { LiveTopic } from '../../shared/src/index.ts';
import { loadAuth, SESSION_COOKIE } from './auth.ts';
import { startBackups, type BackupOptions } from './backup.ts';
import type { Ctx } from './context.ts';
import type { Db } from './db.ts';
import { HttpError } from './http.ts';
import { OPEN_METEO, type WeatherApi } from './hub.ts';
import { startPoller } from './ics/sync.ts';
import { createNudger, type Nudger } from './nudges/nudger.ts';
import { LiveHub } from './live.ts';
import { calendarRoutes } from './routes/calendars.ts';
import { choreRoutes } from './routes/chores.ts';
import { eventRoutes } from './routes/events.ts';
import { hubRoutes } from './routes/hub.ts';
import { memberRoutes } from './routes/members.ts';
import { nudgeRoutes } from './routes/nudges.ts';
import { planRoutes } from './routes/plans.ts';
import { todoRoutes } from './routes/todos.ts';

export interface AppOptions {
  db: Db;
  /** Built web app to serve (web/dist); omitted in dev, where Vite serves it. */
  webDist?: string;
  logger?: boolean;
  /** Refresh subscribed calendars in the background (off in tests). */
  pollFeeds?: boolean;
  /** Check for due nudges every 30 seconds (off in tests, which call app.nudger.tick). */
  runNudges?: boolean;
  /** Where weather and place search come from (tests point this at a local server). */
  weatherApi?: WeatherApi;
  /** Database backups; omitted means none (tests), `nightly` adds the nightly timer. */
  backup?: BackupOptions;
}

declare module 'fastify' {
  interface FastifyInstance {
    nudger: Nudger;
  }
}

export async function buildApp({ db, webDist, logger = false, pollFeeds = false, runNudges = false, weatherApi = OPEN_METEO, backup }: AppOptions) {
  const app = Fastify({ logger: logger ? { level: 'info' } : false, bodyLimit: 256 * 1024 });
  await app.register(cookie);
  await app.register(websocket);

  const live = new LiveHub();
  const ctx: Ctx = { db, changed: (...topics: LiveTopic[]) => live.broadcast(topics) };

  app.decorateRequest('auth', null);
  app.addHook('onRequest', async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    req.auth = token ? loadAuth(db, token) : null;
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.code, message: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: 'invalid', message: err.message });
    req.log.error(err);
    return reply.status(500).send({ error: 'server', message: 'Something went wrong on the home server' });
  });

  app.get('/api/live', { websocket: true }, (socket, req) => {
    if (!req.auth) {
      socket.close(4401, 'Sign in first');
      return;
    }
    live.add(socket);
  });
  app.get('/api/health', async () => ({ ok: true, liveClients: live.size }));

  memberRoutes(app, ctx);
  eventRoutes(app, ctx);
  planRoutes(app, ctx);
  choreRoutes(app, ctx);
  calendarRoutes(app, ctx);
  todoRoutes(app, ctx);
  hubRoutes(app, ctx, { weatherApi, backup });
  const nudger = createNudger(db, { changed: ctx.changed, announce: (n) => live.announce(n) });
  app.decorate('nudger', nudger);
  nudgeRoutes(app, ctx, nudger);

  if (runNudges) {
    const tick = () => nudger.tick().catch((err: unknown) => app.log.error(err, 'nudge check failed'));
    const timer = setInterval(tick, 30_000);
    const first = setTimeout(tick, 3_000);
    app.addHook('onClose', async () => {
      clearInterval(timer);
      clearTimeout(first);
    });
  }

  if (pollFeeds) {
    const stop = startPoller(db, ctx.changed);
    app.addHook('onClose', async () => stop());
  }

  if (backup?.nightly) {
    const stop = startBackups(db, backup, (msg, err) => (err ? app.log.error(err, msg) : app.log.info(msg)));
    app.addHook('onClose', async () => stop());
  }

  if (webDist && existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    // Client-side routes (/week, /person/2 …) all load the app shell.
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/')
        ? reply.status(404).send({ error: 'not_found', message: 'No such API route' })
        : reply.sendFile('index.html'),
    );
  }

  return app;
}
