"""Browser check for chores: the sample family's chore chart, kid-mode ticks, quick add and Settings.

Start a server on a fresh database first (see CLAUDE.md, "Checking the real app in a browser"), then:
    PYTHONIOENCODING=utf-8 python scripts/check-chores.py [base_url]
Prints what it sees and exits non-zero on the first failed check.
"""
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8090'


def check(ok, what):
    print(('ok   ' if ok else 'FAIL ') + what)
    if not ok:
        sys.exit(1)


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE)
    page.get_by_role('button', name='Try it with a sample family').click()

    chart = page.get_by_label('Chore chart')
    chart.wait_for()
    text = chart.inner_text()
    print('Chore chart:', ' | '.join(l for l in text.splitlines() if l.strip()))
    check('Brush teeth' in text and text.count('Brush teeth') == 2, 'shared "Brush teeth" shows once per kid')

    chores = page.request.get(f'{BASE}/api/chores').json()
    garbage = next(c for c in chores if c['text'] == 'Take out the garbage')
    check(garbage['memberIds'] == [], 'garbage is a family job')

    # Kid mode: tick a job, and it stays ticked after a reload.
    kids = [m for m in page.request.get(f'{BASE}/api/members').json() if m['role'] == 'kid']
    page.goto(f"{BASE}/kid/{kids[0]['id']}")
    tile = page.get_by_role('button', name='Brush teeth')
    tile.wait_for()
    tile.click()
    page.wait_for_timeout(500)
    page.reload()
    tile = page.get_by_role('button', name='Brush teeth')
    tile.wait_for()
    check(tile.get_attribute('aria-pressed') == 'true', 'kid-mode tick sticks')

    # Quick add: a to-do that repeats becomes a job.
    page.goto(BASE)
    page.get_by_role('button', name='Add an event or plan').click()
    page.get_by_role('tab', name='To-do or packing').click()
    page.locator('#qa-todo').fill(f"Feed the cat every day {kids[0]['name']}")
    page.get_by_role('button', name='Add to-do').click()
    page.wait_for_timeout(500)
    chores = page.request.get(f'{BASE}/api/chores').json()
    cat = [c for c in chores if c['text'].lower().startswith('feed the cat')]
    check(len(cat) == 1 and cat[0]['rrule'] == 'FREQ=DAILY' and cat[0]['memberIds'] == [kids[0]['id']], 'repeating quick add makes a chore')

    page.goto(f'{BASE}/settings')
    jobs = page.locator('#set-jobs')
    jobs.wait_for()
    text = jobs.inner_text()
    print('Settings jobs:', ' | '.join(l for l in text.splitlines() if l.strip())[:600])
    check('Weekly on' in text and 'Every day' in text and 'Anyone' in text, 'Settings lists repeats and family jobs')

    check(not errors, f'no page errors {errors}')
    browser.close()
