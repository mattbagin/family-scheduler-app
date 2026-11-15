"""Browser check for review fixes b, c, f: Tomorrow with an unassigned event, last Month cell, Escape on the unlock sheet.

Start a server on a fresh database first (see CLAUDE.md), then:
    PYTHONIOENCODING=utf-8 python scripts/check-review-fixes.py [base_url]
"""
import sys
from datetime import date, timedelta
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8090'


def check(ok, what):
    print(('ok   ' if ok else 'FAIL ') + what)
    if not ok:
        sys.exit(1)


def event(title, day, **kw):
    return {'title': title, 'icon': '📅', 'category': 'family', 'start': f'{day}T10:00', 'end': f'{day}T11:00',
            'allDay': False, 'memberIds': [], 'reminders': [], **kw}


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    page.goto(BASE)
    page.get_by_role('button', name='Try it with a sample family').click()
    page.get_by_role('navigation', name='Family members').wait_for()
    members = page.request.get(f'{BASE}/api/members').json()
    parent = next(m for m in members if m['role'] == 'adult')

    # b: tomorrow's first event has nobody on it.
    tomorrow = date.today() + timedelta(days=1)
    # Earliest leave-by of the day, nobody on it, so the hero card (FirstOut) renders with no names.
    r = page.request.post(f'{BASE}/api/events', data={**event('Nobody event', tomorrow.isoformat()),
                          'start': f'{tomorrow}T00:30', 'end': f'{tomorrow}T01:30', 'travelMin': 15})
    check(r.ok, 'created unassigned early event with travel tomorrow')
    page.goto(f'{BASE}/tomorrow')
    hero = page.locator('.tb-hero')
    hero.wait_for()
    text = hero.inner_text()
    print('hero:', repr(text))
    check('Nobody event' in text, 'b: hero is the unassigned event')
    check('Something went wrong' not in page.content(), 'b: Tomorrow renders, no error screen')
    check(not errors, f'b: no console errors {errors}')
    check('  ' not in text and not any(l.strip().startswith('·') for l in text.splitlines()), 'b: no double space or leading separator')
    check('Who’s driving to Nobody event?' in text, 'b: heading reads without a hole')

    # c: event on the last cell of the Month grid.
    first = date.today().replace(day=1)
    nxt = (first.replace(day=28) + timedelta(days=4)).replace(day=1)
    last = nxt - timedelta(days=1)
    gridend = last + timedelta(days=6 - last.weekday())
    r = page.request.post(f'{BASE}/api/events', data=event('Lastcell event', gridend.isoformat()))
    check(r.ok, f'created event on last grid day {gridend}')
    page.goto(f'{BASE}/month')
    page.get_by_role('heading', level=2).first.wait_for()
    page.wait_for_timeout(800)
    label = page.locator('.mday-btn').last.get_attribute('aria-label')
    print('last cell:', label)
    page.locator('.mday-btn').last.click()
    page.get_by_role('dialog').wait_for()
    page.wait_for_timeout(500)
    check('Lastcell event' in page.get_by_role('dialog').inner_text(), 'c: last grid cell lists its event')
    page.keyboard.press('Escape')
    check(page.get_by_role('dialog').count() == 0, 'f: Escape closes a single sheet')

    # f: hub session, QuickAdd -> save -> unlock sheet -> Escape.
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    ctx.request.post(f'{BASE}/api/login', data={'memberId': parent['id'], 'pin': '1234', 'asHub': True})
    hub = ctx.new_page()
    hub.goto(BASE)
    hub.locator('.fab').click()
    hub.locator('#qa-input').fill(f"Escape test tomorrow 3pm {parent['name']}")
    hub.get_by_role('button', name='Add to calendar').click()
    hub.get_by_role('heading', name='A parent’s PIN, please').wait_for()
    check(hub.get_by_role('dialog').locator(':visible').count() >= 1, 'f: unlock sheet shown')
    hub.keyboard.press('Escape')
    hub.wait_for_timeout(300)
    check(hub.get_by_role('heading', name='A parent’s PIN, please').count() == 0, 'f: Escape closed the unlock sheet')
    check(hub.get_by_role('heading', name='Add to calendar').count() + hub.locator('#qa-input').count() >= 1, 'f: form underneath still open (one close only)')
    hub.get_by_role('button', name='Add to calendar').click()
    hub.get_by_role('heading', name='A parent’s PIN, please').wait_for()
    check(True, 'f: form usable again (second save asks for the PIN again)')
    browser.close()
