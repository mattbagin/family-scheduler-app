import type { NotifyPrefs } from './types.ts';

export const DEFAULT_NOTIFY: NotifyPrefs = {
  quietStart: '21:30', quietEnd: '06:30', leaveBy: true, reminders: true, morning: true, evening: true, bills: true,
};

export const REMINDER_CHOICES = [
  { min: 0, label: 'As it starts' },
  { min: 15, label: '15 min before' },
  { min: 60, label: '1 hour before' },
  { min: 1440, label: 'The day before' },
] as const;

export function reminderLabel(min: number): string {
  const known = REMINDER_CHOICES.find((c) => c.min === min);
  if (known) return known.label;
  if (min % 1440 === 0) return `${min / 1440} days before`;
  if (min % 60 === 0) return `${min / 60} hours before`;
  return `${min} min before`;
}

/** Minutes after midnight for an `HH:mm` string. */
export const hhmmToMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

/** Whether `min` (minutes after midnight) falls in quiet hours, which may wrap past midnight. */
export function inQuietHours(p: Pick<NotifyPrefs, 'quietStart' | 'quietEnd'>, min: number): boolean {
  const start = hhmmToMin(p.quietStart);
  const end = hhmmToMin(p.quietEnd);
  if (start === end) return false;
  return start < end ? min >= start && min < end : min >= start || min < end;
}
