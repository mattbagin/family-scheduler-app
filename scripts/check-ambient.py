"""Browser check for the ambient screen's places: each person stands in the right scene (rink, office, road, home),
empty places are not drawn, every member shows exactly once, night mode shows no places, and nothing scrolls sideways.

Start a server on a fresh database first (see CLAUDE.md, "Checking the real app in a browser"), then:
    PYTHONIOENCODING=utf-8 python scripts/check-ambient.py [base_url]
Uses the server's wall-clock time (this machine). It replaces the sample family's statuses and removes the sample events
around today, so run it on a throwaway database. Prints PASS/FAIL per check and exits non-zero if any failed.
"""
import sys
from datetime import datetime, timedelta
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8090'
MOM, DAD, EMMA, LEO = 1, 2, 3, 4
fails = []


def check(ok, what, seen=''):
    print(('PASS ' if ok else 'FAIL ') + what + ('' if ok else f'  (saw: {seen})'))
    if not ok:
        fails.append(what)


now = datetime.now()
mins = now.hour * 60 + now.minute
if mins < 25 or mins > 24 * 60 - 75:
    print('Too close to midnight: the timed data (from 20 minutes ago to 70 minutes ahead) would cross the day. Run again at another time.')
    sys.exit(2)
fmt = lambda d: d.strftime('%Y-%m-%dT%H:%M')
ymd = lambda d: d.strftime('%Y-%m-%d')

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 1280, 'height': 800})
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(BASE)
    page.get_by_role('button', name='Try it with a sample family').click()
    page.get_by_role('navigation', name='Family members').wait_for()
    api = ctx.request

    members = api.get(f'{BASE}/api/members').json()
    names = {m['id']: m['name'] for m in members}
    check([names.get(i) for i in (MOM, DAD, EMMA, LEO)] == ['Mom', 'Dad', 'Emma', 'Leo'], 'sample family ids are Mom 1, Dad 2, Emma 3, Leo 4', names)

    # A clean slate: no sample events around today, no statuses except Mom's office hours.
    check(api.patch(f'{BASE}/api/hub-settings', data={'night': False}).ok, 'night mode switched off')
    occs = api.get(f"{BASE}/api/occurrences?from={ymd(now - timedelta(days=1))}&to={ymd(now + timedelta(days=2))}").json()
    for eid in {o['id'] for o in occs}:
        api.delete(f'{BASE}/api/events/{eid}')
    for m in members:
        sts = [{'icon': '🏢', 'label': 'At the office', 'days': [0, 1, 2, 3, 4, 5, 6], 'start': '00:00', 'end': '23:59'}] if m['id'] == MOM else []
        check(api.patch(f"{BASE}/api/members/{m['id']}", data={'statuses': sts}).ok, f"{m['name']}'s statuses set")

    hockey = api.post(f'{BASE}/api/events', data={'title': 'Hockey practice', 'start': fmt(now - timedelta(minutes=20)), 'end': fmt(now + timedelta(minutes=60)),
                                                  'allDay': False, 'icon': '🏒', 'memberIds': [EMMA]})
    check(hockey.status == 201, 'hockey event for Emma created', hockey.status)
    drive = api.post(f'{BASE}/api/events', data={'title': 'Pickup at Sam’s', 'start': fmt(now + timedelta(minutes=10)), 'end': fmt(now + timedelta(minutes=70)),
                                                 'allDay': False, 'memberIds': [LEO], 'driverId': DAD, 'travelMin': 20})
    check(drive.status == 201, 'drive event (starts in 10 min, 20 min travel, Dad driving) created', drive.status)

    check(api.post(f'{BASE}/api/login', data={'memberId': MOM, 'pin': '1234', 'asHub': True}).ok, 'signed in as the hub')

    expect = {
        EMMA: ('rink', 'Hockey practice'),
        MOM: ('office', 'At the office'),
        DAD: ('road', 'On the road'),
        LEO: ('home', 'At home'),
    }

    def read_places():
        return page.evaluate("""() => [...document.querySelectorAll('[data-place]')].map(pl => ({
            place: pl.dataset.place,
            who: [...pl.querySelectorAll('.amb-who')].map(w => ({ id: +w.dataset.member, name: w.querySelector('b').innerText, label: w.querySelector('small').innerText }))
        }))""")

    def open_ambient(width, height, want=()):
        # The Ambient tab is hidden on a phone by design, so open it wide and then resize.
        # Wait until every wanted place has been drawn (data arrives after the first paint).
        page.set_viewport_size({'width': 1280, 'height': 800})
        page.goto(BASE)
        page.get_by_role('button', name='Ambient').click()
        page.set_viewport_size({'width': width, 'height': height})
        try:
            page.wait_for_function('want => want.every(k => document.querySelector(`[data-place="${k}"]`))', arg=list(want), timeout=15000)
        except Exception:
            check(False, f'places {list(want)} appeared within 15 s', read_places())
            browser.close()
            sys.exit(1)

    # Boxes, in page pixels.
    BOXES = """() => {
        const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
        return {
            lots: Object.fromEntries([...document.querySelectorAll('[data-lot]')].map(l => [l.dataset.lot, r(l)])),
            places: [...document.querySelectorAll('.amb-place')].map(p => ({ place: p.dataset.place, box: r(p), who: [...p.querySelectorAll('.amb-who')].map(w => r(w)) })),
            map: r(document.querySelector('.amb-map')),
            top: r(document.querySelector('.amb-top')),
        };
    }"""
    hit = lambda a, b: a['x'] < b['x'] + b['w'] and b['x'] < a['x'] + a['w'] and a['y'] < b['y'] + b['h'] and b['y'] < a['y'] + a['h']
    mid = lambda b: (b['x'] + b['w'] / 2, b['y'] + b['h'] / 2)

    def check_layout(tag):
        d = page.evaluate(BOXES)
        for pl in d['places']:
            k, b = pl['place'], pl['box']
            if k == 'road':
                m = d['map']
                check(m['x'] <= b['x'] and m['y'] <= b['y'] and b['x'] + b['w'] <= m['x'] + m['w'] and b['y'] + b['h'] <= m['y'] + m['h'], f'{tag}: road group sits inside the map', (b, m))
                continue
            if k not in d['lots']:
                check(False, f'{tag}: a lot is drawn for {k}', list(d['lots']))
                continue
            cx, cy = mid(b)
            dist = {n: (cx - mid(l)[0]) ** 2 + (cy - mid(l)[1]) ** 2 for n, l in d['lots'].items()}
            near = min(dist, key=dist.get)
            check(near == k, f'{tag}: {k} group is nearest its own lot', f'nearest is {near}')
        for pl in d['places']:
            for i, a in enumerate(pl['who']):
                for b in pl['who'][i + 1:]:
                    check(not hit(a, b), f"{tag}: people in {pl['place']} don't overlap")
        whos = [w for pl in d['places'] for w in pl['who']]
        check(not any(hit(w, d['top']) for w in whos), f'{tag}: the clock covers nobody', d['top'])

    open_ambient(1280, 800, ('rink', 'road'))
    places = read_places()
    print('Places:', [(pl['place'], [(w['name'], w['label']) for w in pl['who']]) for pl in places])
    where = {w['id']: (pl['place'], w['label']) for pl in places for w in pl['who']}
    for mid_, (place, label) in expect.items():
        check(where.get(mid_) == (place, label), f"{names[mid_]} is in {place}, labelled {label!r}", where.get(mid_))
    ids = [w['id'] for pl in places for w in pl['who']]
    check(sorted(ids) == sorted(names), 'every member appears exactly once', ids)
    got = sorted(pl['place'] for pl in places)
    check(len(got) == len(set(got)) and got == sorted({v[0] for v in expect.values()}), 'only occupied places are drawn, once each', got)

    for w, h in ((1280, 800), (800, 1280), (390, 844)):
        open_ambient(w, h, ('rink', 'road'))
        # Phones (<= 520px) hide the Ambient tab; there the town only has to fit, so layout is checked on tablet sizes.
        if w > 520:
            check_layout(f'{w}x{h}')
        sw = page.evaluate('document.documentElement.scrollWidth')
        check(sw <= page.evaluate('window.innerWidth'), f'no sideways scroll at {w}x{h}', f'scrollWidth {sw}')

    # Shared places: Leo joins Emma at the rink; Mom and Dad are "out" for different reasons
    # (a gym status with an unusual emoji; a balloon event). Edits need a parent session.
    check(api.post(f'{BASE}/api/login', data={'memberId': MOM, 'pin': '1234'}).ok, 'signed in as a parent for edits')
    check(api.patch(f"{BASE}/api/events/{hockey.json()['id']}", data={'memberIds': [EMMA, LEO]}).ok, 'Leo added to the hockey event')
    check(api.delete(f"{BASE}/api/events/{drive.json()['id']}").status in (200, 204), 'drive event removed')
    check(api.patch(f'{BASE}/api/members/{MOM}', data={'statuses': [{'icon': '🏋️', 'label': 'At the gym', 'days': [0, 1, 2, 3, 4, 5, 6], 'start': '00:00', 'end': '23:59'}]}).ok, 'Mom at the gym (🏋️ status)')
    party = api.post(f'{BASE}/api/events', data={'title': 'Balloon party', 'start': fmt(now - timedelta(minutes=10)), 'end': fmt(now + timedelta(minutes=50)),
                                                 'allDay': False, 'icon': '🎈', 'memberIds': [DAD]})
    check(party.status == 201, 'Dad at a 🎈 event', party.status)
    check(api.post(f'{BASE}/api/login', data={'memberId': MOM, 'pin': '1234', 'asHub': True}).ok, 'signed in as the hub again')

    for w, h in ((1280, 800), (800, 1280)):
        open_ambient(w, h, ('rink', 'out'))
        places = read_places()
        print(f'Shared {w}x{h}:', [(pl['place'], [(x['name'], x['label']) for x in pl['who']]) for pl in places])
        by = {}
        for pl in places:
            by.setdefault(pl['place'], []).append({x['id'] for x in pl['who']})
        check(all(len(v) == 1 for v in by.values()), f'{w}x{h}: one wrapper per place, none duplicated', {k: len(v) for k, v in by.items()})
        check(by.get('rink') == [{EMMA, LEO}], f'{w}x{h}: Emma and Leo share one rink group', by.get('rink'))
        check(by.get('out') == [{MOM, DAD}], f'{w}x{h}: Mom and Dad share one out group', by.get('out'))
        check(page.locator('[data-place="out"]').count() == 1, f'{w}x{h}: exactly one [data-place="out"]', page.locator('[data-place="out"]').count())
        check_layout(f'{w}x{h} shared')

    # Night mode: a parent session turns it on; the plain clock stays, with no places.
    check(api.post(f'{BASE}/api/login', data={'memberId': MOM, 'pin': '1234'}).ok, 'signed back in as a parent')
    check(api.patch(f'{BASE}/api/hub-settings', data={'night': True}).ok, 'night mode switched on')
    page.set_viewport_size({'width': 1280, 'height': 800})
    page.goto(BASE)
    page.get_by_role('button', name='Ambient').click()
    page.locator('.ambient').wait_for()
    page.wait_for_timeout(500)
    check(page.locator('[data-place]').count() == 0, 'night: no places', page.locator('[data-place]').count())
    check(page.locator('.amb-clock').is_visible() and ':' in page.locator('.amb-clock').inner_text(), 'night: the clock is shown', page.locator('.amb-clock').inner_text())
    sw = page.evaluate('document.documentElement.scrollWidth')
    check(sw <= 1280, 'night: no sideways scroll', sw)

    check(not errors, 'no page errors or console errors', errors)
    browser.close()

print(f'\n{len(fails)} failed' if fails else '\nall passed')
sys.exit(1 if fails else 0)
