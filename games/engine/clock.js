// Calendar arithmetic on ISO dates ("1836-09-15"). Pure: uses Date.UTC only as
// a calendar, never the current time.

const DAY_MS = 86400000;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function parse(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!m) throw new Error(`bad date: ${iso}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

export function toDayNumber(iso) {
  const { y, m, d } = parse(iso);
  const dt = new Date(0);
  dt.setUTCFullYear(y, m - 1, d);
  dt.setUTCHours(0, 0, 0, 0);
  return Math.round(dt.getTime() / DAY_MS);
}

export function fromDayNumber(n) {
  const dt = new Date(n * DAY_MS);
  const y = String(dt.getUTCFullYear()).padStart(4, "0");
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export const addDays = (iso, n) => fromDayNumber(toDayNumber(iso) + n);
export const diffDays = (from, to) => toDayNumber(to) - toDayNumber(from);
export const compare = (a, b) => Math.sign(toDayNumber(a) - toDayNumber(b));
export const isBefore = (a, b) => compare(a, b) < 0;
export const month = (iso) => parse(iso).m;
export const dayOfWeek = (iso) => new Date(toDayNumber(iso) * DAY_MS).getUTCDay();

export function season(iso) {
  const m = month(iso);
  if (m === 12 || m <= 2) return "winter";
  if (m <= 5) return "spring";
  if (m <= 8) return "summer";
  return "autumn";
}

// "Thursday, 15 September 1836"
export function format(iso, { weekday = true } = {}) {
  const { y, m, d } = parse(iso);
  const date = `${d} ${MONTHS[m - 1]} ${y}`;
  return weekday ? `${WEEKDAYS[dayOfWeek(iso)]}, ${date}` : date;
}
