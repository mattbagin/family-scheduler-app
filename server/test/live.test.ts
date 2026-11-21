import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';
import { setupFamily } from './helpers.ts';

async function listen(webDist?: string) {
  const app = await buildApp({ db: openDb(':memory:'), webDist, pingMs: 20 });
  const { adult } = await setupFamily(app);
  const msgs: { type: string; build?: string }[] = [];
  const ws = await app.injectWS(
    '/api/live',
    { headers: { cookie: `hb_session=${adult.hb_session}` } },
    { onInit: (w) => w.on('message', (d: Buffer) => msgs.push(JSON.parse(d.toString()))) },
  );
  return { app, ws, msgs };
}

describe('live socket', () => {
  it('says hello with the build and then pings', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'hb-dist-'));
    writeFileSync(join(dist, 'index.html'), '<html></html>');
    const { app, ws, msgs } = await listen(dist);
    await new Promise((r) => setTimeout(r, 120));
    expect(msgs[0].type).toBe('hello');
    expect(msgs[0].build).toMatch(/^\d+(\.\d+)?$/);
    expect(msgs.some((m) => m.type === 'ping')).toBe(true);
    ws.terminate();
    await app.close();
  });

  it('reports build "dev" without a built web app', async () => {
    const { app, ws, msgs } = await listen();
    await new Promise((r) => setTimeout(r, 30));
    expect(msgs[0]).toEqual({ type: 'hello', build: 'dev' });
    ws.terminate();
    await app.close();
  });
});
