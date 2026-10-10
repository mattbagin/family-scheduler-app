import { describe, expect, it } from 'vitest';
import { chipLabel, computeFlags, isSameDayReminder, leaveByTitle, rideHeadsUp, rideStatus, startsInTitle } from '../src/flags.ts';
import { guessTodoKind, parseQuickAdd } from '../src/quickadd.ts';
import type { Member, Occurrence } from '../src/types.ts';

const members: Member[] = [
  { id: 1, name: 'Mom', role: 'adult', color: '#D9487A', avatar: '👩', hasPin: true, sort: 0 },
  { id: 2, name: 'Dad', role: 'adult', color: '#2F7DE1', avatar: '👨', hasPin: true, sort: 1 },
  { id: 3, name: 'Emma', role: 'kid', color: '#DB8616', avatar: '👧', hasPin: false, sort: 2 },
  { id: 4, name: 'Leo', role: 'kid', color: '#1F9C62', avatar: '👦', hasPin: false, sort: 3 },
];
const MONDAY = '2026-09-28';

describe('parseQuickAdd', () => {
  it('reads title, day, time, person, repeat and place', () => {
    const r = parseQuickAdd('Swim Tuesday 4pm Emma weekly at Aquatic Centre', members, MONDAY)!;
    expect(r).toMatchObject({
      title: 'Swim', date: '2026-09-29', startMin: 16 * 60, endMin: null, memberIds: [3], rrule: 'FREQ=WEEKLY;BYDAY=TU',
      location: 'Aquatic Centre', icon: '🏊', category: 'sports',
    });
  });

  it('does not mistake words like "wedding" or "month" for weekdays', () => {
    expect(parseQuickAdd('Wedding Saturday 3pm family', members, MONDAY)).toMatchObject({ title: 'Wedding', date: '2026-10-03' });
    expect(parseQuickAdd('Book club this month', members, MONDAY)).toMatchObject({ title: 'Book club this month', date: null });
  });

  it('reads explicit dates: month names, m/d and "the 15th"', () => {
    expect(parseQuickAdd('Flu shots Oct 12 10am Leo', members, MONDAY)).toMatchObject({ title: 'Flu shots', date: '2026-10-12', startMin: 600 });
    expect(parseQuickAdd('Recital 3rd of December 6pm', members, MONDAY)!.date).toBe('2026-12-03');
    expect(parseQuickAdd('Camp 7/14', members, MONDAY)!.date).toBe('2027-07-14'); // already past this year
    expect(parseQuickAdd('Rent the 1st', members, MONDAY)!.date).toBe('2026-10-01');
    expect(parseQuickAdd('Haircut in 2 weeks', members, MONDAY)!.date).toBe('2026-10-12');
    expect(parseQuickAdd('Picture day Feb 30', members, MONDAY)!.date).toBeNull();
  });

  it('reads time ranges and lengths', () => {
    expect(parseQuickAdd('Soccer Tue 5-6:30pm Emma', members, MONDAY)).toMatchObject({ title: 'Soccer', startMin: 17 * 60, endMin: 18 * 60 + 30 });
    expect(parseQuickAdd('Brunch Sunday 11-1pm family', members, MONDAY)).toMatchObject({ startMin: 11 * 60, endMin: 13 * 60 });
    expect(parseQuickAdd('Party Saturday from 2 to 4', members, MONDAY)).toMatchObject({ title: 'Party', startMin: 14 * 60, endMin: 16 * 60 });
    expect(parseQuickAdd('Movie Friday 7pm for 2 hours', members, MONDAY)).toMatchObject({ title: 'Movie', startMin: 19 * 60, endMin: 21 * 60 });
    expect(parseQuickAdd('Lunch Wed at noon for 45 min Dad', members, MONDAY)).toMatchObject({ title: 'Lunch', startMin: 720, endMin: 765 });
    // A bare number range isn't a time.
    expect(parseQuickAdd('Grades 3-5 concert Thursday 6pm', members, MONDAY)).toMatchObject({ title: 'Grades 3-5 concert', startMin: 18 * 60 });
  });

  it('reads repeat patterns', () => {
    expect(parseQuickAdd('Piano every Tue and Thu 4pm Leo', members, MONDAY)).toMatchObject({ title: 'Piano', date: '2026-09-29', rrule: 'FREQ=WEEKLY;BYDAY=TU,TH' });
    expect(parseQuickAdd('Swim Mondays and Wednesdays 5pm', members, MONDAY)).toMatchObject({ title: 'Swim', date: MONDAY, rrule: 'FREQ=WEEKLY;BYDAY=MO,WE' });
    expect(parseQuickAdd('Hockey every other Saturday 9am', members, MONDAY)).toMatchObject({ title: 'Hockey', rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SA' });
    expect(parseQuickAdd('Walk the dog daily 7am', members, MONDAY)!.rrule).toBe('FREQ=DAILY');
    expect(parseQuickAdd('School run weekdays 8:15am', members, MONDAY)!.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(parseQuickAdd('Library day Friday all day Emma', members, MONDAY)).toMatchObject({ title: 'Library day', allDay: true, startMin: null });
  });

  it('keeps "with" in titles and handles minutes', () => {
    const r = parseQuickAdd('Playdate with Noah Friday 3:30pm Leo', members, MONDAY)!;
    expect(r).toMatchObject({ title: 'Playdate with Noah', date: '2026-10-02', startMin: 15 * 60 + 30, memberIds: [4] });
  });

  it('understands tomorrow, family and bare afternoon hours', () => {
    const r = parseQuickAdd('Pizza night tomorrow at 6 family', members, MONDAY)!;
    expect(r).toMatchObject({ title: 'Pizza night', date: '2026-09-29', startMin: 18 * 60, memberIds: [1, 2, 3, 4] });
  });

  it('treats a weekday that is today as today, and "next" as a week later', () => {
    expect(parseQuickAdd('Dentist Monday 10am Dad', members, MONDAY)!.date).toBe(MONDAY);
    expect(parseQuickAdd('Dentist next Monday 10am Dad', members, MONDAY)!.date).toBe('2026-10-05');
  });

  it('leaves unknown parts empty', () => {
    expect(parseQuickAdd('Call the plumber', members, MONDAY)).toMatchObject({ title: 'Call the plumber', date: null, startMin: null, memberIds: [] });
    expect(parseQuickAdd('   ', members, MONDAY)).toBeNull();
  });

  it('tells prep items from to-dos', () => {
    expect(guessTodoKind('Pack gym shoes')).toBe('prep');
    expect(guessTodoKind('bring a snack to share')).toBe('prep');
    expect(guessTodoKind('Call the plumber')).toBe('todo');
  });

  it('reads who drives as the driver, not someone going', () => {
    // From the critique: this used to come out as "Dentist , drives" with Dad going and nobody driving.
    expect(parseQuickAdd('Emma dentist Tuesday 3:30pm, Dad drives', members, MONDAY)).toMatchObject({
      title: 'Dentist', memberIds: [3], driverId: 2, date: '2026-09-29', startMin: 15 * 60 + 30,
    });
    expect(parseQuickAdd('Soccer Sat 10am Leo, Mom is driving', members, MONDAY)).toMatchObject({ title: 'Soccer', memberIds: [4], driverId: 1 });
    expect(parseQuickAdd('Party Friday 4pm Emma driven by Dad', members, MONDAY)).toMatchObject({ title: 'Party', memberIds: [3], driverId: 2 });
    expect(parseQuickAdd('Swim Thursday 5pm Emma, Dad takes her', members, MONDAY)).toMatchObject({ title: 'Swim', driverId: 2 });
    // A kid isn't a driver, and an adult who is simply named is going.
    expect(parseQuickAdd('Dentist Tuesday 3pm Mom', members, MONDAY)).toMatchObject({ memberIds: [1], driverId: null });
  });

  it('puts "bring …" in the packing note, but leaves a to-do that starts with it alone', () => {
    expect(parseQuickAdd('Leo swim Saturday 10am bring goggles', members, MONDAY)).toMatchObject({ title: 'Swim', bring: 'Goggles', memberIds: [4] });
    expect(parseQuickAdd('Swim Sat 10am Emma, bring goggles and a towel, at Aquatic Centre', members, MONDAY))
      .toMatchObject({ title: 'Swim', bring: 'Goggles and a towel', location: 'Aquatic Centre' });
    expect(parseQuickAdd('Pack gym shoes Thursday Emma', members, MONDAY)).toMatchObject({ title: 'Pack gym shoes', bring: null });
  });

  it('rolls a weekday that is today to next week once its time has passed', () => {
    // From the critique: "Saturday 10am" typed on Saturday at 2:17 PM was booked four hours ago.
    const SATURDAY = '2026-10-03';
    const at = (h: number, m = 0) => ({ nowMin: h * 60 + m });
    expect(parseQuickAdd('Leo swim Saturday 10am', members, SATURDAY, at(14, 17))!.date).toBe('2026-10-10');
    expect(parseQuickAdd('Leo swim Saturday 4pm', members, SATURDAY, at(14, 17))!.date).toBe(SATURDAY);
    expect(parseQuickAdd('Swim every Saturday 10am Leo', members, SATURDAY, at(14, 17))!.date).toBe('2026-10-10');
    // Said outright, today stays today; no time given stays today too.
    expect(parseQuickAdd('Swim today 10am Leo', members, SATURDAY, at(14, 17))!.date).toBe(SATURDAY);
    expect(parseQuickAdd('Swim Saturday Leo', members, SATURDAY, at(14, 17))!.date).toBe(SATURDAY);
  });

  it('leaves drivers and bring notes in a to-do as written', () => {
    expect(parseQuickAdd('Dad drives Leo to practice Friday', members, MONDAY, { event: false }))
      .toMatchObject({ title: 'Drives to practice', memberIds: [2, 4], driverId: null });
    expect(parseQuickAdd('Call school Friday, bring forms', members, MONDAY, { event: false })!.bring).toBeNull();
  });

  it('tidies stray punctuation out of the title', () => {
    expect(parseQuickAdd('Piano, Tuesday 4pm, Leo', members, MONDAY)!.title).toBe('Piano');
    expect(parseQuickAdd('Lunch with Grandma, Sunday noon, family', members, MONDAY)!.title).toBe('Lunch with Grandma');
  });
});

describe('computeFlags', () => {
  const occ = (key: string, start: string, end: string, over: Partial<Occurrence> = {}): Occurrence => ({
    id: Number(key), key, originalDate: start.slice(0, 10), isException: false, calendarId: null, title: key, kidTitle: null,
    icon: '📅', category: 'family', start, end, allDay: false, rrule: null, location: null, notes: null, bring: null,
    travelMin: 0, driverId: null, needsDriver: false, fun: false, memberIds: [], planId: null, reminders: [], ...over,
  });

  it('flags a kid in two places, a double-booked driver and a missing ride', () => {
    const flags = computeFlags([
      occ('1', '2026-09-29T17:00', '2026-09-29T17:45', { memberIds: [3], driverId: 1 }),
      occ('2', '2026-09-29T17:30', '2026-09-29T18:00', { memberIds: [3, 4], driverId: 1 }),
      occ('3', '2026-09-29T19:00', '2026-09-29T20:00', { memberIds: [4], needsDriver: true }),
    ], members);
    expect(flags.get('1')?.map((f) => f.text)).toEqual(['Overlap', 'Mom double-booked']);
    expect(flags.get('3')).toEqual([{ kind: 'warn', text: 'Needs a ride' }]);
  });

  it('ignores back-to-back events and work', () => {
    const flags = computeFlags([
      occ('1', '2026-09-29T08:00', '2026-09-29T09:00', { memberIds: [3] }),
      occ('2', '2026-09-29T09:00', '2026-09-29T10:00', { memberIds: [3] }),
    ], members);
    expect(flags.size).toBe(0);
  });
});

describe('heads-up wording', () => {
  it('says leave-by times in whole minutes, even mid-minute', () => {
    expect(leaveByTitle(25.4, 'Swim')).toBe('Leave in 25 min for Swim');
    expect(leaveByTitle(0.3, 'Swim')).toBe('Leave now for Swim');
    // From the critique: this read "1.1166666666666742 min late".
    expect(leaveByTitle(-1.1166666666666742, 'Swim lesson')).toBe('Leave now for Swim lesson: 1 min late');
    expect(leaveByTitle(-3.6, 'Swim')).toBe('Leave now for Swim: 4 min late');
  });

  it('adds a count to a chip only when the title has no number of its own', () => {
    expect(chipLabel('Pack for tomorrow', 5)).toBe('Pack for tomorrow · 5');
    // Titles with a "d" used to lose their count.
    expect(chipLabel('Hydro bill due Sunday', 2)).toBe('Hydro bill due Sunday · 2');
    expect(chipLabel('3 rides still need a driver', 3)).toBe('3 rides still need a driver');
    expect(chipLabel('Umbrella tomorrow', 1)).toBe('Umbrella tomorrow');
  });
});

describe('rideStatus', () => {
  const leave = 16 * 60 + 5; // 4:05 PM
  const start = 16 * 60 + 30;
  it('stays calm until it is time to go, then says now, then late', () => {
    expect(rideStatus(leave, leave - 20, start)).toEqual({ cls: 'good', text: 'leave 4:05 PM' });
    expect(rideStatus(leave, leave + 0.4, start)).toEqual({ cls: 'warn', text: 'leave now' });
    expect(rideStatus(leave, leave + 4, start)).toEqual({ cls: 'warn', text: '4 min late' });
    expect(rideStatus(leave, leave + 7.2, start)).toEqual({ cls: 'bad', text: '7 min late' });
  });
  it('is calm again once the event has started', () => {
    expect(rideStatus(leave, start + 1, start).cls).toBe('good');
  });
});

describe('one clock', () => {
  it('keeps a same-day reminder current', () => {
    expect(startsInTitle(13.4, 'Dentist')).toBe('Dentist in 13 min');
    expect(startsInTitle(0.2, 'Dentist')).toBe('Dentist is starting');
  });
  it('words a ride heads-up like the timeline pill, and colours it the same way', () => {
    const leave = 15 * 60 + 10; // 3:10 PM
    expect(rideHeadsUp(leave, leave - 47, 'Mom', 'Playdate')).toEqual({ cls: '', text: 'Mom leaves 3:10 PM for Playdate' });
    expect(rideHeadsUp(leave, leave + 2, 'Mom', 'Playdate')).toEqual({ cls: 'warn', text: 'Leave now for Playdate: 2 min late' });
    expect(rideHeadsUp(leave, leave + 6, 'Mom', 'Playdate')).toEqual({ cls: 'bad', text: 'Leave now for Playdate: 6 min late' });
  });
  it('spots reminders for later today, not tomorrow or another day', () => {
    expect(isSameDayReminder('👵 Call Grandma in 15 min')).toBe(true);
    expect(isSameDayReminder('🦷 Dentist in 1h 30m')).toBe(true);
    expect(isSameDayReminder('⚽ Soccer is starting')).toBe(true);
    expect(isSameDayReminder('⚽ Soccer tomorrow at 4:30 PM')).toBe(false);
    expect(isSameDayReminder('🎂 Party on Saturday')).toBe(false);
    expect(isSameDayReminder('🏊 Swim in the lake tomorrow')).toBe(false);
  });
});
