import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { toLocalDateTime, ymd, type BackupInfo } from '../../shared/src/index.ts';
import type { Db } from './db.ts';

export interface BackupOptions {
  dir: string;
  /** How many backups to keep; older ones are deleted. */
  keep: number;
  /** Make one each night (after 3 AM, or when the computer next wakes). */
  nightly?: boolean;
}

const NAME = /^homebase-(\d{4}-\d{2}-\d{2})-(\d{4})\.db$/;
const NIGHTLY_HOUR = 3;

export function listBackups({ dir, keep }: BackupOptions): BackupInfo {
  const files = existsSync(dir)
    ? readdirSync(dir).filter((n) => NAME.test(n)).sort().reverse().map((name) => {
      const st = statSync(join(dir, name));
      return { name, size: st.size, at: st.mtime.toISOString() };
    })
    : [];
  return { dir, keep, files };
}

/**
 * Copies the database to `homebase-YYYY-MM-DD-HHmm.db` with VACUUM INTO, which is safe while
 * the app is running, then deletes all but the newest `keep` copies.
 */
export function backupNow(db: Db, opts: BackupOptions, now = new Date()): string {
  mkdirSync(opts.dir, { recursive: true });
  const name = `homebase-${toLocalDateTime(now).replace('T', '-').replace(':', '')}.db`;
  const file = join(opts.dir, name);
  rmSync(file, { force: true });
  db.prepare('VACUUM INTO ?').run(file);
  for (const old of listBackups(opts).files.slice(Math.max(1, opts.keep))) rmSync(join(opts.dir, old.name), { force: true });
  return name;
}

/** True once tonight's backup is due: after 3 AM with none made yet today, or none at all. */
export function backupDue(opts: BackupOptions, now = new Date()): boolean {
  const files = listBackups(opts).files;
  if (!files.length) return true;
  const today = ymd(now);
  return now.getHours() >= NIGHTLY_HOUR && !files.some((f) => NAME.exec(f.name)?.[1] === today);
}

/** Checks every 15 minutes; returns a stop function. */
export function startBackups(db: Db, opts: BackupOptions, log: (msg: string, err?: unknown) => void): () => void {
  const check = () => {
    try {
      if (backupDue(opts)) log(`Backed up the database to ${join(opts.dir, backupNow(db, opts))}`);
    } catch (err) {
      log('Backup failed', err);
    }
  };
  const first = setTimeout(check, 10_000);
  const timer = setInterval(check, 15 * 60_000);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
