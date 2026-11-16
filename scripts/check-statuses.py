"""Browser check for daily statuses: faces on Today, the Week row labels, the Settings editor, and days off
(a "Vacation" event, and a public-holiday feed from canada-holidays.ca, so it needs the internet).

Start a server on a fresh database first (see CLAUDE.md, "Checking the real app in a browser"), then:
    PYTHONIOENCODING=utf-8 python scripts/check-statuses.py [base_url] [screenshot_dir]
Prints what it sees and exits non-zero on the first failed check.
"""
import sys
from datetime import datetime, timedelta
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8090'
SHOTS = sys.argv[2] if len(sys.argv) > 2 else None


def check(ok, what):
    print(('ok   ' if ok else 'FAIL ') + what)
    if not ok:
        sys.exit(1)


def active(statuses, now):
    mins = now.hour * 60 + now.minute
    hm = lambda s: int(s[:2]) * 60 + int(s[3:])
    return next((s for s in statuses if now.weekday() in s['days'] and hm(s['start']) <= mins < hm(s['end'])), None)


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE)
    page.get_by_role('button', name='Try it with a sample family').click()
    page.get_by_role('navigation', name='Family members').wait_for()

    members = page.request.get(f'{BASE}/api/members').json()
    check(all(m['statuses'] for m in members), 'everyone in the sample family has a status')

    # Today: a face carries its status (badge and label) only while it applies.
    now = datetime.now()
    for m in members:
        link = page.get_by_role('navigation', name='Family members').locator('.mem-btn', has_text=m['name'])
        label = link.get_attribute('aria-label')
        badge = link.locator('.status')
        st = active(m['statuses'], now)
        print(f"Today {m['name']}: {label!r}")
        if st:
            check(st['label'] in label and badge.inner_text() == st['icon'], f"{m['name']} shows {st['label']}")
        else:
            check(badge.count() == 0, f"{m['name']} shows no status right now")
    if SHOTS:
        page.locator('.hero').screenshot(path=f'{SHOTS}/statuses-today.png')

    # Week: each row label lists the person's statuses with their days.
    page.goto(f'{BASE}/week')
    for m in members:
        lab = page.locator('.rowlab', has_text=m['name'])
        text = ' | '.join(l for l in lab.inner_text().splitlines() if l.strip())
        print(f'Week {text}')
        check(lab.locator('.rl-status').count() == len(m['statuses']), f"{m['name']}'s row lists {len(m['statuses'])} status(es)")
    mom = page.locator('.rowlab', has_text='Mom').inner_text()
    check('Mon, Tue, Thu' in mom and 'Wed, Fri' in mom, 'office and home days read briefly')

    # Settings on a phone: add a preset to Leo, change its days, save, and see it on Week.
    page.set_viewport_size({'width': 390, 'height': 844})
    page.goto(f'{BASE}/settings')
    page.locator('.setting-row', has_text='Leo').get_by_role('button', name='Edit').click()
    editor = page.locator('.member-editor')
    adds = editor.get_by_role('group', name='Add a status').inner_text()
    print('Add buttons:', ' | '.join(adds.split('\n')))
    check('At preschool' not in adds and 'At school' in adds and 'At work' not in adds, 'presets suit a kid and skip ones in use')
    editor.get_by_role('button', name='At daycare').click()
    days = editor.get_by_role('group', name='Days for At daycare')
    days.get_by_role('button', name='Monday').click()
    days.get_by_role('button', name='Saturday').click()
    wide = page.evaluate('document.documentElement.scrollWidth')
    check(wide <= 390, f'editor fits a phone (page {wide}px wide)')
    if SHOTS:
        editor.screenshot(path=f'{SHOTS}/statuses-editor.png')
    editor.get_by_role('button', name='Save').click()
    page.get_by_text('Saved Leo').wait_for()
    leo = next(m for m in page.request.get(f'{BASE}/api/members').json() if m['name'] == 'Leo')
    print('Leo now:', leo['statuses'])
    check([s['label'] for s in leo['statuses']] == ['At preschool', 'At daycare'], 'daycare added after preschool')
    check(leo['statuses'][1]['days'] == [1, 2, 3, 4, 5], 'daycare is Tue–Sat')

    # Leaving the label empty is caught before saving.
    page.locator('.setting-row', has_text='Leo').get_by_role('button', name='Edit').click()
    editor.get_by_role('button', name='Something else').click()
    editor.get_by_role('button', name='Save').click()
    check(editor.is_visible(), 'an unnamed status keeps the editor open')

    mom_id = next(m['id'] for m in members if m['name'] == 'Mom')
    # Colours: pick one on Mom's first status in Settings, then give her an all-day status so one applies now.
    page.goto(f'{BASE}/settings')
    page.locator('.setting-row', has_text='Mom').get_by_role('button', name='Edit').click()
    editor = page.locator('.member-editor')
    first_colors = editor.locator('.st-colors').first
    check(first_colors.get_by_role('button', name='No color').get_attribute('aria-pressed') == 'true', 'a status starts with no color')
    first_colors.get_by_role('button', name='Color #2F7DE1').click()
    editor.get_by_role('button', name='Save').click()
    page.get_by_text('Saved Mom').wait_for()
    mom = next(m for m in page.request.get(f'{BASE}/api/members').json() if m['name'] == 'Mom')
    check(mom['statuses'][0].get('color') == '#2F7DE1', 'the status colour is saved')
    mom['statuses'].insert(0, {'icon': '🎯', 'label': 'Colour check', 'days': [0, 1, 2, 3, 4, 5, 6], 'start': '00:00', 'end': '23:59', 'color': '#E0533D'})
    check(page.request.patch(f"{BASE}/api/members/{mom_id}", data={'statuses': mom['statuses']}).ok, 'gave Mom an all-day coloured status')

    page.set_viewport_size({'width': 1280, 'height': 900})
    ring = 'getComputedStyle(el).borderTopColor'
    red = 'rgb(224, 83, 61)'
    page.goto(BASE)
    page.get_by_role('navigation', name='Family members').locator('.mem-btn', has_text='Mom').locator('.avatar').wait_for()
    get = lambda sel: page.locator(sel).first.evaluate(f'el => {ring}')
    check(get('.mem-btn:has-text("Mom") .avatar') == red, "Today: Mom's ring takes the status colour")
    check(page.locator('.mem-btn:has-text("Mom") .status').first.evaluate(f'el => {ring}') == red, 'Today: her badge takes it too')
    page.goto(f'{BASE}/week')
    page.locator('.rowlab:has-text("Mom") .avatar').wait_for()
    check(get('.rowlab:has-text("Mom") .avatar') == red, "Week: Mom's ring takes the status colour")
    page.goto(BASE)
    page.get_by_role('button', name='Ambient').click()
    page.locator('.amb-p:has-text("Mom") .avatar').wait_for()
    check(get('.amb-p:has-text("Mom") .avatar') == red, "Ambient: Mom's ring takes the status colour")
    if SHOTS:
        page.screenshot(path=f'{SHOTS}/statuses-ambient.png')
    page.get_by_role('button', name='Wake the screen').click()

    # Days off: a vacation today takes Mom's status away (whatever the time).
    page.set_viewport_size({'width': 1280, 'height': 900})
    mom_id = next(m['id'] for m in members if m['name'] == 'Mom')
    today = now.strftime('%Y-%m-%d')
    tomorrow = (now + timedelta(days=1)).strftime('%Y-%m-%d')
    made = page.request.post(f'{BASE}/api/events', data={'title': 'Vacation', 'start': f'{today}T00:00', 'end': f'{tomorrow}T00:00', 'allDay': True, 'memberIds': [mom_id]})
    check(made.status == 201, 'added a vacation day for Mom')
    page.goto(BASE)
    mom_btn = page.get_by_role('navigation', name='Family members').locator('.mem-btn', has_text='Mom')
    mom_btn.wait_for()
    print('Today Mom on vacation:', repr(mom_btn.get_attribute('aria-label')))
    check(mom_btn.locator('.status').count() == 0, 'no status for Mom on her vacation')

    # Holidays: subscribe to Ontario's from Settings in one tap; it's marked as days off.
    page.goto(f'{BASE}/settings')
    page.get_by_role('button', name='+ Subscribe to a calendar').click()
    page.get_by_role('button', name='Use these holidays').click()
    preview = page.locator('.feed-preview', has_text='Coming up')
    preview.wait_for(timeout=20000)
    if SHOTS:
        page.locator('form', has=preview).screenshot(path=f'{SHOTS}/statuses-holidays.png')
    print('Preview:', ' | '.join(l for l in preview.inner_text().splitlines() if l.strip()))
    check(page.get_by_role('button', name='Every all-day event here is a day off').get_attribute('aria-pressed') == 'true', 'days off is switched on')
    page.get_by_role('button', name='Subscribe').click()
    page.get_by_text('Subscribed to Ontario holidays').wait_for(timeout=20000)
    cal = next(c for c in page.request.get(f'{BASE}/api/calendars').json() if c['name'] == 'Ontario holidays')
    print('Calendar:', {k: cal[k] for k in ('name', 'daysOff', 'eventCount', 'memberIds', 'lastError')})
    check(cal['daysOff'] and cal['eventCount'] >= 9 and len(cal['memberIds']) == len(members), 'holidays are days off for everyone')

    check(not errors, f'no page errors {errors}')
    browser.close()
