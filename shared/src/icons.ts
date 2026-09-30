import type { Category } from './types.ts';

export const CATEGORIES: { id: Category; label: string; icon: string }[] = [
  { id: 'family', label: 'Family', icon: '🏡' },
  { id: 'school', label: 'School', icon: '🏫' },
  { id: 'sports', label: 'Sports', icon: '⚽' },
  { id: 'playdate', label: 'Playdates & parties', icon: '🧸' },
  { id: 'medical', label: 'Appointments', icon: '🩺' },
  { id: 'bills', label: 'Money', icon: '💵' },
  { id: 'work', label: 'Work', icon: '💼' },
  { id: 'other', label: 'Other', icon: '📅' },
];

/** Keyword → icon and category, checked in order; used by quick add and new events. */
const EVENT_KEYWORDS: [RegExp, string, Category][] = [
  [/swim/, '🏊', 'sports'],
  [/soccer|football/, '⚽', 'sports'],
  [/hockey|skat/, '⛸️', 'sports'],
  [/basketball/, '🏀', 'sports'],
  [/baseball|t-ball|tball/, '⚾', 'sports'],
  [/dance|ballet/, '🩰', 'sports'],
  [/gymnastic/, '🤸', 'sports'],
  [/karate|martial/, '🥋', 'sports'],
  [/practice|game|tournament|match/, '🏅', 'sports'],
  [/dentist|teeth cleaning/, '🦷', 'medical'],
  [/doctor|checkup|check-up|dr\.? |pediatric|vaccin/, '🩺', 'medical'],
  [/haircut|barber/, '💇', 'medical'],
  [/birthday|party/, '🎂', 'playdate'],
  [/playdate|play date|sleepover/, '🧸', 'playdate'],
  [/pizza/, '🍕', 'family'],
  [/taco/, '🌮', 'family'],
  [/dinner|lunch|brunch|breakfast/, '🍽️', 'family'],
  [/grandma|grandpa|nana|papa|granny/, '👵', 'family'],
  [/thanksgiving/, '🦃', 'family'],
  [/christmas/, '🎄', 'family'],
  [/halloween/, '🎃', 'family'],
  [/trip|vacation|camp/, '🧳', 'family'],
  [/movie/, '🍿', 'family'],
  [/music|piano|guitar|violin|drum/, '🎵', 'school'],
  [/library/, '📚', 'school'],
  [/art\b|craft/, '🎨', 'school'],
  [/school|class|teacher|field trip/, '🏫', 'school'],
  [/pay|bill|rent|mortgage|tax/, '💵', 'bills'],
  [/work|meeting|office/, '💼', 'work'],
];

export function guessEventStyle(text: string): { icon: string; category: Category } {
  const t = text.toLowerCase();
  const hit = EVENT_KEYWORDS.find(([re]) => re.test(t));
  return hit ? { icon: hit[1], category: hit[2] } : { icon: '📅', category: 'family' };
}

const TASK_KEYWORDS: [string, string][] = [
  ['turkey', '🍗'], ['cook', '🍳'], ['bake', '🥧'], ['pie', '🥧'], ['cake', '🎂'], ['drink', '🥤'], ['wine', '🍷'],
  ['vacuum', '🧹'], ['sweep', '🧹'], ['mop', '🧽'], ['clean', '🧽'], ['dust', '🪶'], ['chair', '🪑'], ['table', '🍽️'],
  ['napkin', '🧻'], ['card', '🖍️'], ['decor', '🎃'], ['balloon', '🎈'], ['shop', '🛒'], ['buy', '🛒'], ['order', '🛒'],
  ['grocer', '🛒'], ['invite', '✉️'], ['gift', '🎁'], ['wrap', '🎁'], ['dish', '🍽️'], ['trash', '🗑️'], ['garbage', '🗑️'],
  ['menu', '📝'], ['plan', '📝'], ['book', '📞'], ['call', '📞'], ['pack', '🧳'], ['laundry', '🧺'], ['bed', '🛏️'],
  ['teeth', '🪥'], ['toy', '🧸'], ['plant', '🪴'], ['dog', '🐕'], ['cat', '🐈'], ['fish', '🐟'], ['feed', '🐾'],
  ['water', '💧'], ['homework', '📓'], ['read', '📖'], ['sock', '🧦'], ['shoe', '👟'], ['yard', '🍂'], ['rake', '🍂'],
];

export function guessTaskIcon(text: string): string {
  const t = text.toLowerCase();
  return TASK_KEYWORDS.find(([k]) => t.includes(k))?.[1] ?? '✅';
}

export function guessPlanIcon(title: string): string {
  const t = title.toLowerCase();
  if (/thanksgiving|turkey/.test(t)) return '🦃';
  if (/birthday|party/.test(t)) return '🎉';
  if (/trip|vacation|camp/.test(t)) return '🧳';
  if (/christmas|holiday/.test(t)) return '🎄';
  if (/halloween/.test(t)) return '🎃';
  if (/move|moving/.test(t)) return '📦';
  if (/garage sale|yard sale/.test(t)) return '🏷️';
  return '📋';
}

export const MEMBER_COLORS = ['#D9487A', '#2F7DE1', '#DB8616', '#1F9C62', '#8B5CF6', '#E0533D', '#0E9AA7', '#B7791F'];
export const MEMBER_AVATARS = ['👩', '👨', '👧', '👦', '👶', '🧒', '👵', '👴', '🧑', '👱‍♀️', '👱', '🧔', '🐶', '🐱', '🦊', '🐼', '🦄', '🦖'];
export const EVENT_ICONS = ['📅', '🏫', '⚽', '🏊', '🩰', '🎵', '🎨', '📚', '🦷', '🩺', '🎂', '🧸', '🍽️', '🌮', '🍕', '👵', '🦃', '🎄', '🧳', '💼', '💵', '🛒', '🚗', '🏥', '🎉', '⛸️', '🏀', '⚾', '🥋', '🍿'];
