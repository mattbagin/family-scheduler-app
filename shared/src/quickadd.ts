import { guessEventStyle } from './icons.ts';
import { formatRRule, type RRule } from './recurrence.ts';
import { addDays, daysInMonth, weekdayMon } from './time.ts';
import type { Category, Member, TodoKind, Ymd } from './types.ts';

export interface QuickAddResult {
  title: string;
  memberIds: number[];
  date: Ymd | null;
  startMin: number | null;
  /** When it ends, in minutes after midnight of `date` (past 1440 runs overnight); null = default length. */
  endMin: number | null;
  allDay: boolean;
  rrule: string | null;
  location: string | null;
  /** A parent named as the driver ("Dad drives"); they aren't counted as going. */
  driverId: number | null;
  /** What to bring ("…, bring goggles"), for the event's packing note. */
  bring: string | null;
  icon: string;
  category: Category;
}

/** A weekday word ("tue", "Tuesday"), but not "wedding" or "month". */
const DAY_WORD = '(?:mon(?:day)?|tues?(?:day)?|wed(?:nesday)?|thu(?:rs?)?(?:day)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)';
const DAY = `${DAY_WORD}s?`;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const LIST_SEP = '\\s*(?:,|and|&|\\+)\\s*';
const CONNECTOR = /^(on|at|for|and|with|to|in|from|by|&)$/i;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 0 = Monday; callers have already matched a weekday word. */
const dayIndex = (word: string) => ['mo', 'tu', 'we', 'th', 'fr', 'sa', 'su'].indexOf(word.slice(0, 2).toLowerCase());
const monthIndex = (word: string) => MONTHS.indexOf(word.slice(0, 3).toLowerCase()) + 1;

const ymdOf = (y: number, m: number, d: number): Ymd | null =>
  m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m) ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;

/** The next date (today counts, unless skipToday) that falls on weekday `wd`. */
function nextWeekday(today: Ymd, wd: number, skipToday = false): Ymd {
  const diff = (wd - weekdayMon(today) + 7) % 7;
  return addDays(today, diff === 0 && skipToday ? 7 : diff);
}

/** A month and day with no year: this year, or next year if it has passed. */
function upcoming(today: Ymd, month: number, day: number): Ymd | null {
  const y = Number(today.slice(0, 4));
  const d = ymdOf(y, month, day);
  return d && d >= today ? d : ymdOf(y + 1, month, day);
}

function toMin(h: number, m: number, ampm: string | undefined): number {
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  return h * 60 + m;
}

const RANGE = /\b(from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;

/**
 * Turns "Soccer Tue 5-6pm Emma weekly at Riverside" into a draft event: who, which day, when,
 * how often and where, with what's left over as the title. Times without am/pm before 8 are
 * read as afternoon (family events rarely start at 5 AM).
 */
export function parseQuickAdd(text: string, members: Member[], today: Ymd, opts: { event?: boolean; nowMin?: number } = {}): QuickAddResult | null {
  // A driver and a packing note belong to events; a to-do keeps those words as written.
  const event = opts.event ?? true;
  const raw = text.trim();
  if (!raw) return null;
  let rest = ` ${raw} `;
  /** Finds a pattern, removes it from what's left, and returns the match. */
  const take = (re: RegExp): RegExpMatchArray | null => {
    const m = rest.match(re);
    if (m) rest = `${rest.slice(0, m.index)} ${rest.slice(m.index! + m[0].length)}`;
    return m;
  };
  let m: RegExpMatchArray | null;

  /* ---- who's driving: "Dad drives", "Mom is driving", "driven by Dad", "Dad takes her" ---- */
  // Read before who's going, so the driver isn't counted as a passenger.
  let driverId: number | null = null;
  const adults = members.filter((x) => x.role === 'adult');
  if (event && adults.length) {
    const names = adults.map((x) => escapeRe(x.name)).join('|');
    const d = take(new RegExp(`\\b(${names})\\s+(?:is\\s+|will\\s+)?(?:driv(?:es|ing|e)|tak(?:es|ing)\\s+(?:them|her|him|us|everyone|the kids))\\b`, 'i'))
      ?? take(new RegExp(`\\bdriven\\s+by\\s+(${names})\\b`, 'i'));
    if (d) driverId = adults.find((x) => x.name.toLowerCase() === d[1].toLowerCase())!.id;
  }

  /* ---- who ---- */
  const memberIds: number[] = [];
  for (const mem of members) {
    const re = new RegExp(`\\b${escapeRe(mem.name)}(?:'s|’s)?(?![\\w'’])`, 'i');
    if (!take(re)) continue;
    memberIds.push(mem.id);
    while (take(re));
  }
  if (take(/\b(the )?(whole )?(family|everyone|all of us)\b/i)) memberIds.splice(0, memberIds.length, ...members.map((x) => x.id));

  const allDay = !!take(/\ball[- ]day\b/i);

  /* ---- how often ---- */
  let repeat: RRule | null = null;
  if (take(/\b(every other( week)?|every (2|two) weeks|every second week|biweekly|fortnightly)\b/i)) repeat = { freq: 'WEEKLY', interval: 2 };
  if (take(/\b(daily|every ?day)\b/i)) repeat = { freq: 'DAILY', interval: 1 };
  else if (take(/\b(every )?weekdays?\b/i)) repeat = { freq: 'WEEKLY', interval: 1, byDay: [0, 1, 2, 3, 4] };
  else if (take(/\b(monthly|every month)\b/i)) repeat = { freq: 'MONTHLY', interval: 1 };
  // "every Tue and Thu", or plurals like "Tuesdays and Thursdays".
  const list = take(new RegExp(`\\bevery\\s+(${DAY}(?:${LIST_SEP}${DAY})*)\\b`, 'i'))
    ?? take(new RegExp(`\\b(${DAY_WORD}s(?:${LIST_SEP}${DAY_WORD}s)*)\\b`, 'i'));
  if (list) {
    const days = [...new Set(list[1].split(new RegExp(LIST_SEP, 'i')).map(dayIndex).filter((d) => d >= 0))].sort();
    if (days.length) repeat = { freq: 'WEEKLY', interval: repeat?.interval ?? 1, byDay: days };
  }
  if (take(/\b(weekly|every week)\b/i)) repeat ??= { freq: 'WEEKLY', interval: 1 };

  /* ---- which day ---- */
  let date: Ymd | null = null;
  // Set when the day came from a weekday name ("Saturday"), which can mean next week once its time has passed.
  let byWeekday = false;
  if (take(/\b(today|tonight)\b/i)) date = today;
  else if (take(/\btomorrow\b/i)) date = addDays(today, 1);
  else if ((m = take(/\bin\s+(\d{1,2}|a|one|two|three)\s+(days?|weeks?)\b/i))) {
    const n = ({ a: 1, one: 1, two: 2, three: 3 } as Record<string, number>)[m[1].toLowerCase()] ?? Number(m[1]);
    date = addDays(today, n * (m[2].toLowerCase().startsWith('week') ? 7 : 1));
  } else if ((m = take(new RegExp(`\\b(?:on\\s+)?${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i')))) {
    date = upcoming(today, monthIndex(m[1]), Number(m[2]));
  } else if ((m = take(new RegExp(`\\b(?:on\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}(?![a-z])`, 'i')))) {
    date = upcoming(today, monthIndex(m[2]), Number(m[1]));
  } else if ((m = take(/\b(?:on\s+)?(\d{1,2})\/(\d{1,2})\b(?!\/)/))) {
    date = upcoming(today, Number(m[1]), Number(m[2]));
  } else if ((m = take(/\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b/i))) {
    // "the 15th": this month, or next month once it has passed.
    const [y, mo] = today.split('-').map(Number);
    const here = ymdOf(y, mo, Number(m[1]));
    date = here && here >= today ? here : ymdOf(mo === 12 ? y + 1 : y, (mo % 12) + 1, Number(m[1]));
  } else if ((m = take(new RegExp(`\\b(next\\s+)?(${DAY})\\b`, 'i')))) {
    date = nextWeekday(today, dayIndex(m[2]), !!m[1]);
    byWeekday = true;
  }
  if (!date && repeat?.freq === 'WEEKLY' && repeat.byDay?.length) {
    date = repeat.byDay.map((d) => nextWeekday(today, d)).sort()[0];
    byWeekday = true;
  }

  /* ---- what time ---- */
  let startMin: number | null = null;
  let endMin: number | null = null;
  const r = rest.match(RANGE);
  // Only a range with am/pm, minutes or "from" is a time: "grades 3-5" isn't.
  if (r && (r[1] || r[3] || r[4] || r[6] || r[7])) {
    take(RANGE);
    const [sh, sm, eh, em] = [r[2], r[3], r[5], r[6]].map((x) => Number(x ?? 0));
    const endAmpm = r[7]?.toLowerCase();
    let startAmpm = r[4]?.toLowerCase();
    // "11-1pm" is 11 AM to 1 PM; "5-6pm" is 5 PM to 6 PM.
    if (!startAmpm && endAmpm) startAmpm = toMin(sh, sm, endAmpm) > toMin(eh, em, endAmpm) ? 'am' : endAmpm;
    startMin = toMin(sh, sm, startAmpm) + (!startAmpm && sh < 8 ? 720 : 0);
    endMin = toMin(eh, em, endAmpm) + (!endAmpm && eh < 8 ? 720 : 0);
    if (endMin <= startMin) endMin += 1440;
  } else if (take(/\b(?:at\s+)?noon\b/i)) {
    startMin = 12 * 60;
  } else if ((m = take(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i) ?? take(/\b(?:at\s+)?(\d{1,2}):(\d{2})\b/) ?? take(/\bat (\d{1,2})\b(?![:/\d])/i))) {
    const h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    const ampm = m[3]?.toLowerCase();
    if (h <= 23 && min < 60) startMin = toMin(h, min, ampm) + (!ampm && h < 8 ? 720 : 0);
  }
  // "Saturday 10am" typed on Saturday afternoon means next Saturday, not four hours ago.
  if (byWeekday && date === today && startMin !== null && opts.nowMin !== undefined && startMin < opts.nowMin) date = addDays(today, 7);

  const dur = take(/\bfor\s+(an?|one|half an|\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?)\b/i);
  if (dur && startMin !== null && endMin === null) {
    const n = ({ a: 1, an: 1, one: 1, 'half an': 0.5 } as Record<string, number>)[dur[1].toLowerCase()] ?? Number(dur[1]);
    endMin = startMin + Math.round(n * (dur[2].toLowerCase().startsWith('h') ? 60 : 1));
  }

  /* ---- where ---- */
  let location: string | null = null;
  const lm = rest.match(/\bat\s+([A-Za-z][\w'’ .-]*?)\s*$/i) ?? rest.match(/\bat\s+([A-Za-z][\w'’ .-]*?)\s+(?=on\b|with\b|for\b)/i);
  if (lm) {
    location = lm[1].trim();
    rest = rest.replace(lm[0], ' ');
  }

  /* ---- what to bring: "…, bring goggles and a towel" ---- */
  // "Pack gym shoes" on its own is a packing to-do, so only take it when something comes first.
  let bring: string | null = null;
  const bm = rest.match(/\s(?:bring|bringing|pack|packing)\s+([^,;]+)/i);
  if (event && bm && /[a-z0-9]/i.test(rest.slice(0, bm.index)) && bm[1].trim()) {
    const b = bm[1].trim();
    bring = b[0].toUpperCase() + b.slice(1);
    rest = rest.replace(bm[0], ' ');
  }

  // What's left is the title, without the commas that separated the parts already taken out.
  const words = rest.replace(/\s+/g, ' ').trim().split(' ').filter((w) => w && !/^[,;:.!?–—-]+$/.test(w));
  const tidy = () => {
    if (words.length) words[words.length - 1] = words[words.length - 1].replace(/[,;:]+$/, '');
    if (words.length) words[0] = words[0].replace(/^[,;:]+/, '');
  };
  tidy();
  while (words.length && CONNECTOR.test(words[words.length - 1])) { words.pop(); tidy(); }
  while (words.length && CONNECTOR.test(words[0])) { words.shift(); tidy(); }
  const joined = words.join(' ');
  const title = joined ? joined[0].toUpperCase() + joined.slice(1) : 'New event';

  let rrule: string | null = null;
  if (repeat) {
    if (repeat.freq === 'WEEKLY' && !repeat.byDay?.length && date) repeat.byDay = [weekdayMon(date)];
    if (repeat.freq !== 'WEEKLY' || repeat.byDay?.length) rrule = formatRRule(repeat);
  }
  const { icon, category } = guessEventStyle(raw);
  return { title, memberIds, date, startMin, endMin: allDay ? null : endMin, allDay, rrule, location, driverId, bring, icon, category };
}

/** "Pack gym shoes", "bring a snack" and "take library books" are prep; anything else is a to-do. */
export function guessTodoKind(text: string): TodoKind {
  return /^\s*(pack|bring|take|wear|return)\b/i.test(text) ? 'prep' : 'todo';
}
