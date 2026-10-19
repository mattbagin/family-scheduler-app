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
    line = page.get_by_role('dialog').inner_text()
    check('so it goes on the chore chart as a job' in line, 'quick add to-do with a repeat shows the "goes on the chore chart" line')
    check(page.get_by_role('button', name='Add to-do').count() == 0, 'quick add button no longer says "Add to-do" for a repeat')
    page.get_by_role('button', name='Add job', exact=True).click()
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

    # Job sheet from Today's chart: two kids, weekly on two days.
    def chores_named(name):
        return [c for c in page.request.get(f'{BASE}/api/chores').json() if c['text'] == name]

    kid_ids = [k['id'] for k in kids]
    page.goto(BASE)
    page.get_by_label('Chore chart').get_by_role('button', name='+ Add a job').click()
    dlg = page.get_by_role('dialog')
    dlg.locator('#cs-text').fill('Water the plants')
    for k in kids:
        dlg.get_by_role('button', name=k['name']).click()
    dlg.locator('#cs-repeat').select_option('weekly')
    dlg.get_by_label('Repeat on').get_by_role('button', name='Tue').click()
    dlg.get_by_label('Repeat on').get_by_role('button', name='Fri').click()
    # With nothing picked the sheet shows (and saves) the start day's weekday; unpress it if it isn't Tue or Fri.
    for d in ['Mon', 'Wed', 'Thu', 'Sat', 'Sun']:
        b = dlg.get_by_label('Repeat on').get_by_role('button', name=d)
        if b.get_attribute('aria-pressed') == 'true':
            b.click()
    dlg.get_by_role('button', name='Add job', exact=True).click()
    page.wait_for_timeout(500)
    water = chores_named('Water the plants')
    print('Water the plants:', water)
    check(len(water) == 1 and sorted(water[0]['memberIds']) == sorted(kid_ids), 'chart sheet: one job for both kids')
    rr = water[0]['rrule']
    days = rr.split('BYDAY=')[1].split(';')[0].split(',') if 'BYDAY=' in rr else []
    check(rr.startswith('FREQ=WEEKLY;') and 'TU' in days and 'FR' in days and len(days) == 2, f'chart sheet: weekly rule on two days ({rr})')

    # Monthly-day job for Anyone.
    page.goto(BASE)
    page.get_by_label('Chore chart').get_by_role('button', name='+ Add a job').click()
    dlg = page.get_by_role('dialog')
    dlg.locator('#cs-text').fill('Wipe the shelves')
    dlg.get_by_role('button', name='Anyone').click()
    dlg.locator('#cs-repeat').select_option('monthly-day')
    dlg.get_by_role('button', name='Add job', exact=True).click()
    page.wait_for_timeout(500)
    shelves = chores_named('Wipe the shelves')
    check(len(shelves) == 1 and shelves[0]['memberIds'] == [] and shelves[0]['rrule'].startswith('FREQ=MONTHLY;BYDAY='), f'monthly-day job for Anyone ({shelves and shelves[0]["rrule"]})')

    # Person page: the kid is pre-selected; empty state; sheet cancels.
    page.goto(f"{BASE}/person/{kids[1]['id']}")
    page.get_by_role('heading', name='Today’s jobs').wait_for()
    page.get_by_role('button', name='+ Add a job').click()
    dlg = page.get_by_role('dialog')
    check(dlg.get_by_role('button', name=kids[1]['name']).get_attribute('aria-pressed') == 'true', 'person page sheet pre-presses that kid')
    check(dlg.get_by_role('button', name=kids[0]['name']).get_attribute('aria-pressed') == 'false', 'person page sheet leaves the other kid off')
    dlg.get_by_role('button', name='Cancel').click()
    adults = [m for m in page.request.get(f'{BASE}/api/members').json() if m['role'] != 'kid']
    page.goto(f"{BASE}/person/{adults[0]['id']}")
    page.get_by_role('heading', name='Today’s jobs').wait_for()
    check('No jobs today.' in page.inner_text('body'), 'person page shows "No jobs today." when empty')

    # Settings: edit by clicking the row, then remove.
    page.goto(f'{BASE}/settings')
    page.locator('#set-jobs').get_by_role('button', name='Water the plants').click()
    dlg = page.get_by_role('dialog')
    check(dlg.get_by_role('heading', name='Edit job').count() == 1, 'Settings row opens "Edit job"')
    dlg.locator('#cs-text').fill('Water plants')
    dlg.get_by_role('button', name='Save changes').click()
    page.wait_for_timeout(500)
    check(len(chores_named('Water plants')) == 1 and not chores_named('Water the plants'), 'renamed job saved')
    page.locator('#set-jobs').get_by_role('button', name='Water plants').click()
    dlg = page.get_by_role('dialog')
    dlg.get_by_role('button', name='Remove').click()
    dlg.get_by_role('button', name='Yes, remove').click()
    page.wait_for_timeout(500)
    check(not chores_named('Water plants'), 'removed job is gone')

    check(not errors, f'no page errors {errors}')
    browser.close()
