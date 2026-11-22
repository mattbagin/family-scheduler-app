"""Browser check for PLAN.md section 13 (b new plan sheet, d shared clock) plus a console/fonts sweep.

Start a server on a fresh database first (see CLAUDE.md), then:
    PYTHONIOENCODING=utf-8 python scripts/check-review-polish.py [base_url]
"""
import re, sys, time
from datetime import date
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8090'
fails = []


def check(ok, what, detail=''):
    print(('ok   ' if ok else 'FAIL ') + what + ('' if ok else f'  [{detail}]'))
    if not ok:
        fails.append(what)


POLL = """() => { window.__seen = []; window.__bad = false; window.__t0 = Date.now();
  window.__iv = setInterval(() => { const t = document.body.innerText;
    if (t.includes('This plan was removed.')) window.__bad = true;
    if (Date.now() - window.__t0 > 2000) clearInterval(window.__iv); }, 30); }"""


def clock_text(page, sel):
    return page.locator(sel).first.inner_text().replace('\n', '')


with sync_playwright() as p:
    browser = p.chromium.launch()
    for name, (w, h) in {'phone': (390, 844), 'desktop': (1280, 800)}.items():
        ctx = browser.new_context(viewport={'width': w, 'height': h})
        page = ctx.new_page()
        errors, fonts = [], []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
        page.on('request', lambda r: re.search(r'fonts\.(googleapis|gstatic)\.com', r.url) and fonts.append(r.url))
        page.goto(BASE)
        if not page.get_by_role('button', name='Try it with a sample family').count():  # already set up: sign in as a parent
            page.request.post(f'{BASE}/api/login', data={'memberId': 1, 'pin': '1234'})  # 1 = Mom in the sample family
            page.goto(BASE)
        if page.get_by_role('button', name='Try it with a sample family').count():
            page.get_by_role('button', name='Try it with a sample family').click()
        page.get_by_role('navigation', name='Family members').wait_for()
        today = date.today().isoformat()
        title = f'Plan src {name}'
        page.request.post(f'{BASE}/api/events', data={'title': title, 'icon': '📅', 'category': 'family', 'start': f'{today}T23:00',
                          'end': f'{today}T23:30', 'allDay': False, 'memberIds': [], 'reminders': []})
        page.reload()
        page.get_by_text(title).first.click()
        page.evaluate(POLL)
        page.get_by_role('button', name='Break into tasks').click()
        page.get_by_placeholder('e.g. Leo’s birthday party').count()
        page.wait_for_timeout(2300)
        bad = page.evaluate('window.__bad')
        txt = page.locator('.sheet').last.inner_text()
        check(not bad and title in txt and 'removed' not in txt, f'{name}: event -> plan never shows "removed", shows plan', txt[:80])
        # delete the real plan
        page.get_by_role('button', name='Remove plan').click()
        page.get_by_role('button', name=re.compile('^(Yes|Remove|Confirm)', re.I)).last.click()
        page.wait_for_timeout(800)
        check(page.locator('.scrim').count() == 0, f'{name}: removing the plan closes the sheet', page.locator('.scrim').count())

        # quick add
        page.get_by_role('button', name='Add an event or plan').click()
        page.get_by_role('tab', name='Plan with tasks').click()
        page.get_by_placeholder('e.g. Leo’s birthday party').fill(f'QA plan {name}')
        page.evaluate(POLL)
        page.get_by_role('button', name='Create plan').click()
        page.wait_for_timeout(2300)
        txt = page.locator('.sheet').last.inner_text()
        check(not page.evaluate('window.__bad') and f'QA plan {name}' in txt, f'{name}: quick add plan never shows "removed", shows plan', txt[:80])
        page.keyboard.press('Escape')

        # shared clock on Today (fake clock)
        ctx2 = browser.new_context(viewport={'width': w, 'height': h})
        pg = ctx2.new_page()
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and errors.append(m.text))
        pg.clock.install(time=f'{today}T10:00:00')
        parent = next(m for m in page.request.get(f'{BASE}/api/members').json() if m['role'] == 'adult')
        pg.request.post(f'{BASE}/api/login', data={'memberId': parent['id'], 'pin': '1234', 'asHub': True})
        pg.goto(BASE)
        pg.locator('.hero').first.wait_for()
        phone = w < 521  # the Today clock is hidden on phones by design
        if not phone:
            a = clock_text(pg, '.clock')
            pg.clock.fast_forward(150_000)
            pg.wait_for_timeout(500)
            b = clock_text(pg, '.clock')
            check(a != b, f'{name}: Today clock advances', f'{a} -> {b}')
        # all time-ish elements agree: Today clock vs the timeline window start
        pg.locator('.amb-tab').dispatch_event('click') if pg.get_by_role('button', name='Ambient').is_visible() else None
        pg.wait_for_timeout(500)
        if pg.locator('.ambient').count():
            c = clock_text(pg, '.amb-clock')
            pg.clock.fast_forward(180_000)
            pg.wait_for_timeout(500)
            d = clock_text(pg, '.amb-clock')
            check(c != d, f'{name}: ambient clock advances', f'{c} -> {d}')
            if not phone:
                pg.mouse.click(5, 5)
                pg.wait_for_timeout(300)
                e = clock_text(pg, '.clock')
                m = re.search(r'(\d+):(\d+)', d), re.search(r'(\d+):(\d+)', e)
                check(m[0] and m[1] and m[0].groups() == m[1].groups(), f'{name}: ambient and Today clocks agree', f'{d} vs {e}')
        else:
            print(f'skip {name}: no Ambient tab for this (non-hub) session')
        ctx2.close()

        # sweep
        for path in ['/', '/week', '/month', '/settings', '/kid']:
            page.goto(BASE + path)
            page.wait_for_load_state('networkidle')
            page.wait_for_timeout(400)
        check(not errors, f'{name}: no console/page errors across sweep', errors[:3])
        check(not fonts, f'{name}: no google fonts requests', fonts[:3])
        ctx.close()
    browser.close()
sys.exit(1 if fails else 0)
