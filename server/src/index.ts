import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { openDb } from './db.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dbFile = resolve(process.env.HOMEBASE_DB ?? resolve(here, '../data/homebase.db'));
const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '0.0.0.0';
const backupDir = resolve(process.env.HOMEBASE_BACKUP_DIR ?? resolve(dirname(dbFile), 'backups'));
const keep = Math.max(1, Number(process.env.HOMEBASE_BACKUP_KEEP ?? 14) || 14);

mkdirSync(dirname(dbFile), { recursive: true });
const db = openDb(dbFile);
const app = await buildApp({
  db, webDist: resolve(here, '../../web/dist'), logger: true, pollFeeds: true, runNudges: true,
  backup: { dir: backupDir, keep, nightly: true },
});

await app.listen({ port, host });
app.log.info(`Homebase is running on http://localhost:${port} (database: ${dbFile}, backups: ${backupDir})`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    db.close();
    process.exit(0);
  });
}
