import { guessEventStyle } from './icons.ts';
import { addDays, weekdayMon } from './time.ts';
import type { Category, Member, Ymd } from './types.ts';

export interface QuickAddResult {
  title: string;
  memberIds: number[];
  date: Ymd | null;
  startMin: number | null;
  weekly: boolean;
  location: string | null;
  icon: string;
  category: Category;
}

const WEEKDAY_PREFIXES = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const CONNECTOR = /^(on|at|for|and|with|to|in)$/i;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Turns "Soccer Tue 5pm Emma weekly at Riverside" into a draft event.
 * Times without am/pm before 8 are read as afternoon (family events rarely start at 5 AM).
 */
export function parseQuickAdd(text: string, members: Member[], today: Ymd): QuickAddResult | null {
  const raw = text.trim();
  if (!raw) return null;
  const lower = ` ${raw.toLowerCase()} `;
  let rest = ` ${raw} `;
  const strip = (re: RegExp) => {
    rest = rest.replace(re, ' ');
  };

  let memberIds = members.filter((m) => new RegExp(`\\b${escapeRe(m.name)}\\b`, 'i').test(lower)).map((m) => m.id);
  for (const m of members) strip(new RegExp(`\\b${escapeRe(m.name)}('s|’s)?\\b`, 'gi'));
  if (/\b(family|everyone|all of us)\b/.test(lower)) {
    memberIds = members.map((m) => m.id);
    strip(/\b(the )?(whole )?(family|everyone|all of us)\b/gi);
  }

  let date: Ymd | null = null;
  if (/\btoday\b|\btonight\b/.test(lower)) {
    date = today;
    strip(/\b(today|tonight)\b/gi);
  } else if (/\btomorrow\b/.test(lower)) {
    date = addDays(today, 1);
    strip(/\btomorrow\b/gi);
  } else {
    const m = lower.match(/\b(next\s+)?(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/);
    if (m) {
      const target = WEEKDAY_PREFIXES.indexOf(m[2]);
      let diff = (target - weekdayMon(today) + 7) % 7;
      if (m[1] && diff === 0) diff = 7;
      date = addDays(today, diff);
      strip(new RegExp(`\\b${escapeRe(m[0].trim())}s?\\b`, 'gi'));
    }
  }

  const weekly = /\b(weekly|every)\b/.test(lower);
  strip(/\b(every week|weekly|every)\b/gi);

  let startMin: number | null = null;
  const tm = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/) ?? lower.match(/\b(\d{1,2}):(\d{2})\b/) ?? lower.match(/\bat (\d{1,2})\b(?!:)/);
  if (tm) {
    let h = Number(tm[1]);
    const min = Number(tm[2] ?? 0);
    const ampm = tm[3];
    if (h <= 23 && min < 60) {
      if (ampm === 'pm' && h < 12) h += 12;
      if (ampm === 'am' && h === 12) h = 0;
      if (!ampm && h < 8) h += 12;
      startMin = h * 60 + min;
      const token = escapeRe(tm[0].trim()).replace(/\s+/g, '\\s*');
      strip(new RegExp(`\\b(at\\s+)?${token}\\b`, 'i'));
    }
  }

  let location: string | null = null;
  const lm = rest.match(/\bat\s+([A-Za-z][\w'’ .-]*?)\s*$/i) ?? rest.match(/\bat\s+([A-Za-z][\w'’ .-]*?)\s+(?=on\b|with\b|for\b)/i);
  if (lm) {
    location = lm[1].trim();
    rest = rest.replace(lm[0], ' ');
  }

  const words = rest.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  while (words.length && CONNECTOR.test(words[words.length - 1])) words.pop();
  while (words.length && CONNECTOR.test(words[0])) words.shift();
  const joined = words.join(' ');
  const title = joined ? joined[0].toUpperCase() + joined.slice(1) : 'New event';
  const { icon, category } = guessEventStyle(raw);
  return { title, memberIds, date, startMin, weekly, location, icon, category };
}
