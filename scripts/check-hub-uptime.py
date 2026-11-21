"""Browser check for PLAN.md section 12, step 2 (a hub that stays on): idle goes ambient on /week and /kid (not with a
sheet open), websocket hello {build} and ping, reload after a deploy, and the night-mode drift.

Run from the repo root (it builds, starts a server on a fresh database, restarts it for the deploy check, and stops it):
    PYTHONIOENCODING=utf-8 python scripts/check-hub-uptime.py
Uses Playwright's fake clock to skip the 2-minute idle wait. Prints PASS/FAIL per check; exits non-zero on any FAIL.
"""
import json, os, subprocess, sys, tempfile, time
from datetime import datetime, timedelta
from playwright.sync_api import sync_playwright

PORT = 8090
BASE = f'http://localhost:{PORT}'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(tempfile.gettempdir(), f'hub-uptime-{int(time.time())}.db')
fails = []


def check(ok, what, seen=''):
    print(('PASS ' if ok else 'FAIL ') + what + ('' if ok else f'  (saw: {seen})'))
    if not ok:
        fails.append(what)


def build():
    subprocess.run('npm run build', cwd=ROOT, shell=True, check=True, capture_output=True)


def stop():
    subprocess.run(['powershell', '-NoProfile', '-Command',
                    f'Get-NetTCPConnection -LocalPort {PORT} -State Listen -ErrorAction SilentlyContinue | % {{ Stop-Process -Id $_.OwningProcess -Force }}'],
                   capture_output=True)
    time.sleep(1)


def start():
    env = dict(os.environ, PORT=str(PORT), HOMEBASE_DB=DB)
    proc = subprocess.Popen(['node', '--disable-warning=ExperimentalWarning', 'server/src/index.ts'], cwd=ROOT, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    import urllib.request
    for _ in range(50):
        try:
            urllib.request.urlopen(BASE + '/api/health', timeout=1)
            return proc
        except Exception as e:
            if getattr(e, 'code', None):
                return proc
            time.sleep(0.3)
    raise RuntimeError('server did not start')


def go_ambient(page, path):
    page.goto(BASE + path)
    page.wait_for_load_state('networkidle')
    page.clock.fast_forward(130_000)
    try:
        page.wait_for_selector('.ambient', timeout=5000)
        return True
    except Exception:
        return False


try:
    stop()
    build()
    start()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        errors = []

        # A parent session for setup and API calls.
        parent = browser.new_context(viewport={'width': 1280, 'height': 800})
        pp = parent.new_page()
        pp.goto(BASE)
        pp.get_by_role('button', name='Try it with a sample family').click()
        pp.get_by_role('navigation', name='Family members').wait_for()
        api = parent.request
        api.patch(f'{BASE}/api/hub-settings', data={'night': False})

        # The hub device.
        hub = browser.new_context(viewport={'width': 1280, 'height': 800})
        r = hub.request.post(f'{BASE}/api/login', data={'memberId': 1, 'pin': '1234', 'asHub': True})
        check(r.ok, 'hub login', r.status)
        page = hub.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        frames = []
        page.on('websocket', lambda ws: ws.on('framereceived', lambda f: frames.append((time.time(), f if isinstance(f, str) else f.decode()))))
        page.clock.install()

        # 1 and 2: idle goes ambient on /week and /kid.
        check(go_ambient(page, '/week'), '1. idle on /week goes ambient')
        page.mouse.click(600, 400)
        page.wait_for_timeout(500)
        check(page.locator('.ambient').count() == 0, '1b. tap wakes it')
        check(go_ambient(page, '/kid'), '2. idle on /kid goes ambient')

        # 3: not with a sheet open.
        page.goto(BASE + '/week')
        page.wait_for_load_state('networkidle')
        page.get_by_role('button', name='Add something').first.click() if page.get_by_role('button', name='Add something').count() else page.locator('.fab').click()
        page.wait_for_selector('.scrim', timeout=5000)
        page.clock.fast_forward(130_000)
        page.wait_for_timeout(1500)
        check(page.locator('.scrim').count() > 0 and page.locator('.ambient').count() == 0, '3. no ambient while a sheet is open',
              f"scrim={page.locator('.scrim').count()} ambient={page.locator('.ambient').count()}")

        # 4: hello with a build id, then a ping within ~25 s.
        page.goto(BASE + '/week')
        frames.clear()
        t0 = time.time()
        deadline = t0 + 30
        while time.time() < deadline and not any('"ping"' in f for _, f in frames):
            page.wait_for_timeout(500)
        msgs = [json.loads(f) for _, f in frames if f.startswith('{')]
        hello = next((m for m in msgs if m.get('type') == 'hello'), None)
        check(bool(hello) and msgs[0].get('type') == 'hello' and isinstance(hello.get('build'), str) and hello['build'] != 'dev',
              '4a. first ws message is hello with a non-dev build', msgs[:2])
        ping_at = next((t - t0 for t, f in frames if '"ping"' in f), None)
        check(ping_at is not None and ping_at <= 25, '4b. ping arrives within 25 s', ping_at)

        # 5: deploy reload while ambient.
        page.goto(BASE + '/week')
        page.wait_for_load_state('networkidle')
        page.evaluate('window.__marker = 1')
        page.clock.fast_forward(130_000)
        page.wait_for_selector('.ambient', timeout=5000)
        loads = []
        page.on('load', lambda: loads.append(1))
        stop()
        build()
        start()
        for _ in range(40):
            if loads:
                break
            page.wait_for_timeout(500)
        page.wait_for_load_state('load')
        check(bool(loads) and page.evaluate('window.__marker') is None, '5. ambient hub reloads itself after the redeploy',
              f'loads={len(loads)}')

        # 6: night mode drift.
        now = datetime.now()
        hm = lambda d: d.strftime('%H:%M')
        api.patch(f'{BASE}/api/hub-settings', data={'night': True, 'nightStart': hm(now - timedelta(hours=1)), 'nightEnd': hm(now + timedelta(hours=1))})
        page.wait_for_timeout(1500)
        ok = go_ambient(page, '/week')
        check(ok and page.locator('.ambient.night').count() == 1, '6a. ambient is in night mode')
        info = page.evaluate("""() => document.querySelector('.ambient.night .amb-content').getAnimations()
            .map(a => ({name: a.animationName, state: a.playState, t: a.currentTime}))""")
        check(any(a['name'] == 'amb-drift' and a['state'] == 'running' for a in info), '6b. amb-drift is running', info)
        tf = lambda: page.evaluate("getComputedStyle(document.querySelector('.ambient.night .amb-content')).transform")
        a = tf()
        time.sleep(20)
        b = tf()
        check(a != b, '6c. transform changes over 20 s', f'{a} -> {b}')

        # 7
        check(not errors, '7. no console errors', errors[:3])
        browser.close()
finally:
    stop()

sys.exit(1 if fails else 0)
