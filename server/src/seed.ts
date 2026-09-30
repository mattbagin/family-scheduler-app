import { addDays, weekdayMon, type Ymd } from '../../shared/src/index.ts';
import { hashPin } from './auth.ts';
import { run, setSetting, tx, type Db } from './db.ts';
import { eventDefaults, insertEvent, type EventInput } from './routes/events.ts';
import { addTask, createPlan } from './routes/plans.ts';

const DAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/**
 * The sample family from the mockup, laid out around `today` so the app looks lived-in on
 * first launch. Both parents' PIN is 1234.
 */
export function seedSample(db: Db, today: Ymd): { adultIds: number[] } {
  return tx(db, () => {
    setSetting(db, 'familyName', 'The Sample Family');
    const pin = hashPin('1234');
    const add = (name: string, role: 'adult' | 'kid', color: string, avatar: string, sort: number) =>
      run(db, 'INSERT INTO members (name, role, color, avatar, pin_hash, sort) VALUES (?, ?, ?, ?, ?, ?)',
        name, role, color, avatar, role === 'adult' ? pin : null, sort).id;
    const mom = add('Mom', 'adult', '#D9487A', '👩', 0);
    const dad = add('Dad', 'adult', '#2F7DE1', '👨', 1);
    const emma = add('Emma', 'kid', '#DB8616', '👧', 2);
    const leo = add('Leo', 'kid', '#1F9C62', '👦', 3);
    const everyone = [mom, dad, emma, leo];

    const d = (offset: number) => addDays(today, offset);
    const ev = (offset: number, start: string, end: string, e: Partial<EventInput> & { title: string }) =>
      insertEvent(db, eventDefaults({ ...e, start: `${d(offset)}T${start}`, end: `${d(offset)}T${end}` }));
    const lastWeek = -7;
    // The weekend fun lands on the coming Saturday and Sunday, whatever day it is now.
    const sat = (5 - weekdayMon(today) + 7) % 7 || 7;
    const weekdays = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';

    ev(lastWeek, '08:30', '15:00', { title: 'School', kidTitle: 'School', icon: '🏫', category: 'school', rrule: weekdays, memberIds: [emma] });
    ev(lastWeek, '09:00', '12:00', { title: 'Preschool', kidTitle: 'Preschool', icon: '🎨', category: 'school', rrule: weekdays, memberIds: [leo] });
    ev(lastWeek, '08:00', '16:00', { title: 'Work', icon: '💼', category: 'work', rrule: weekdays, memberIds: [dad] });
    ev(lastWeek, '09:00', '12:30', { title: 'Work', icon: '💻', category: 'work', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,TH', memberIds: [mom] });
    ev(lastWeek, '16:30', '17:30', {
      title: 'Soccer practice', kidTitle: 'Soccer', icon: '⚽', category: 'sports', rrule: `FREQ=WEEKLY;BYDAY=${DAY_CODES[weekdayMon(today)]}`,
      memberIds: [emma], driverId: dad, travelMin: 15, location: 'Riverside Park, field 3', bring: 'Cleats and a water bottle',
    });
    ev(lastWeek, '19:00', '19:30', { title: 'Bath and stories', kidTitle: 'Bath time', icon: '🛁', category: 'family', rrule: 'FREQ=DAILY', memberIds: [leo] });

    ev(0, '13:00', '14:00', { title: 'Dentist cleaning', icon: '🦷', category: 'medical', memberIds: [mom], location: 'Bright Smiles Dental' });
    ev(0, '15:30', '17:00', { title: 'Playdate with Sam', kidTitle: 'Play at Sam’s', icon: '🧸', category: 'playdate', memberIds: [leo], driverId: mom, travelMin: 10, location: 'Sam’s house, 14 Elm St' });
    ev(0, '18:00', '18:45', { title: 'Taco night', kidTitle: 'Dinner', icon: '🌮', category: 'family', memberIds: everyone });
    ev(0, '19:30', '21:00', { title: 'Book club', icon: '📚', category: 'family', memberIds: [mom], location: 'Priya’s place' });

    ev(1, '17:00', '17:45', { title: 'Swim lesson', kidTitle: 'Swimming', icon: '🏊', category: 'sports', memberIds: [emma], needsDriver: true, travelMin: 20, location: 'Aquatic Centre', bring: 'Swimsuit and goggles' });
    ev(1, '17:00', '17:45', { title: 'Music class', kidTitle: 'Music', icon: '🥁', category: 'school', memberIds: [leo], needsDriver: true, travelMin: 10, location: 'Little Notes Studio' });
    insertEvent(db, eventDefaults({ title: 'Library day', icon: '📚', category: 'school', allDay: true, start: `${d(1)}T00:00`, end: `${d(2)}T00:00`, memberIds: [emma], bring: 'Library books' }));
    insertEvent(db, eventDefaults({ title: 'Show and tell', icon: '🦖', category: 'school', allDay: true, start: `${d(1)}T00:00`, end: `${d(2)}T00:00`, memberIds: [leo], bring: 'A toy for show and tell' }));
    ev(2, '16:00', '16:30', { title: 'Parent-teacher meeting', icon: '🍎', category: 'school', memberIds: [mom, dad], location: 'Room 12' });
    ev(3, '13:30', '14:10', { title: 'Checkup, Dr. Patel', kidTitle: 'Doctor visit', icon: '🩺', category: 'medical', memberIds: [leo, mom] });
    ev(sat, '10:00', '11:00', { title: 'Soccer game vs. Hawks', kidTitle: 'Soccer game', icon: '🥅', category: 'sports', memberIds: everyone, driverId: dad, travelMin: 15 });
    ev(sat, '14:00', '16:00', { title: 'Mia’s birthday party', kidTitle: 'Mia’s party', icon: '🎂', category: 'playdate', memberIds: [emma], needsDriver: true, travelMin: 12, fun: true, bring: 'Wrapped gift' });
    ev(sat + 1, '12:00', '14:00', { title: 'Lunch at Grandma’s', kidTitle: 'Grandma’s house', icon: '👵', category: 'family', memberIds: everyone, fun: true, driverId: dad, travelMin: 30 });
    ev(12, '15:00', '17:00', { title: 'Leo’s birthday party', kidTitle: 'My birthday!', icon: '🎈', category: 'family', memberIds: everyone, fun: true });

    const thanksgiving = ev(10, '17:00', '21:00', {
      title: 'Hosting Thanksgiving', kidTitle: 'Thanksgiving!', icon: '🦃', category: 'family', memberIds: everyone, fun: true, location: 'Home · 14 guests',
    });
    const plan = createPlan(db, thanksgiving, 'Hosting Thanksgiving', '🦃', 'Extended family, 14 people');
    const tasks: [string, string, number, number][] = [
      ['Plan the menu', '📝', mom, -3], ['Order the turkey', '🛒', dad, 1], ['Get drinks', '🥤', mom, 8],
      ['Borrow extra chairs', '🪑', dad, 9], ['Bake pumpkin pie', '🥧', mom, 9], ['Vacuum the floors', '🧹', emma, 9],
      ['Make place cards', '🖍️', emma, 9], ['Fold the napkins', '🧻', leo, 10], ['Cook the turkey', '🍗', dad, 10],
    ];
    for (const [text, icon, who, due] of tasks) addTask(db, plan, { text, icon, assigneeId: who, due: d(due) });
    run(db, "UPDATE plan_tasks SET done_at = ? WHERE plan_id = ? AND text = 'Plan the menu'", new Date().toISOString(), plan);

    const chores: [string, string, number][] = [
      ['Make bed', '🛏️', emma], ['Feed Goldie', '🐟', emma], ['Set the table', '🍽️', emma], ['Brush teeth', '🪥', emma],
      ['Toys away', '🧸', leo], ['Water plant', '🪴', leo], ['Socks in hamper', '🧦', leo], ['Brush teeth', '🪥', leo],
    ];
    chores.forEach(([text, icon, who], i) => {
      const { id } = run(db, 'INSERT INTO chores (text, icon, assignee_id, sort) VALUES (?, ?, ?, ?)', text, icon, who, i);
      if (text === 'Make bed' || text === 'Toys away') {
        run(db, 'INSERT INTO chore_completions (chore_id, date, completed_at) VALUES (?, ?, ?)', id, today, new Date().toISOString());
      }
    });

    run(db, 'INSERT INTO bills (name, icon, amount_cents, due, monthly) VALUES (?, ?, ?, ?, 1)', 'Hydro', '💡', 14260, d(2));
    run(db, 'INSERT INTO bills (name, icon, amount_cents, due, monthly, autopay) VALUES (?, ?, ?, ?, 1, 1)', 'Internet', '📶', 8900, d(5));
    run(db, 'INSERT INTO bills (name, icon, amount_cents, due) VALUES (?, ?, ?, ?)', 'Swim lessons (fall)', '🏊', 12000, d(9));

    return { adultIds: [mom, dad] };
  });
}
