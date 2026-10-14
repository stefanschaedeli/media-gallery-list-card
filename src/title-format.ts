/**
 * Tolerant timestamp extraction + day.js-style formatting for media item titles.
 *
 * Media sources (UniFi Protect, Frigate, folder sources, ...) name their items
 * differently; we try a series of patterns against the title, then the
 * media_content_id, and fall back to the raw title when nothing parses.
 */

/** Sanity range for parsed results — rejects false-positive number matches. */
const MIN_YEAR = 2001;
const MAX_YEAR = 2099;

function validDate(d: Date): Date | undefined {
  if (isNaN(d.getTime())) return undefined;
  const y = d.getFullYear();
  return y >= MIN_YEAR && y <= MAX_YEAR ? d : undefined;
}

function fromParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number
): Date | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  const d = new Date(year, month - 1, day, hour, minute, second);
  // new Date() rolls over out-of-range days (Feb 31 → Mar 3); reject those.
  if (d.getMonth() !== month - 1 || d.getDate() !== day) return undefined;
  return validDate(d);
}

/** ISO 8601-ish: 2026-07-30T14:32:05, 2026-07-30 14:32, 2026/07/30 14:32:05 */
function parseIso(text: string): Date | undefined {
  const m = text.match(
    /(\d{4})[-/](\d{2})[-/](\d{2})[T _](\d{2}):(\d{2})(?::(\d{2}))?/
  );
  if (!m) return undefined;
  return fromParts(+m[1], +m[2], +m[3], +m[4], +m[5], m[6] ? +m[6] : 0);
}

/** Compact filename style: 20260730_143205, 20260730-143205 */
function parseCompact(text: string): Date | undefined {
  const m = text.match(/(?:^|\D)(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})(?:\D|$)/);
  if (!m) return undefined;
  return fromParts(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);
}

/** Epoch seconds or milliseconds, incl. Frigate event ids like 1717230000.123456-abcdef */
function parseEpoch(text: string): Date | undefined {
  const m = text.match(/(?:^|\D)(\d{13}|\d{10})(?:\D|$)/);
  if (!m) return undefined;
  const n = +m[1];
  const ms = m[1].length === 13 ? n : n * 1000;
  return validDate(new Date(ms));
}

/**
 * Locale-style dates:
 *  - "30.07.2026 14:32(:05)" / "30.07.26, 14:32" — "." separator → day-first
 *  - "7/30/2026, 2:32:05 PM" / "30/07/2026 14:32" — "/" separator → month-first,
 *    unless the first number is >12 (then it must be the day)
 */
function parseLocale(text: string): Date | undefined {
  const m = text.match(
    /(\d{1,2})([./])(\d{1,2})\2(\d{2,4}),? +(\d{1,2}):(\d{2})(?::(\d{2}))? ?([AP]M)?/i
  );
  if (!m) return undefined;
  const a = +m[1];
  const b = +m[3];
  let year = +m[4];
  if (year < 100) year += 2000;
  const dayFirst = m[2] === "." || a > 12;
  const day = dayFirst ? a : b;
  const month = dayFirst ? b : a;
  let hour = +m[5];
  const ampm = m[8]?.toUpperCase();
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  return fromParts(year, month, day, hour, +m[6], m[7] ? +m[7] : 0);
}

const PARSERS = [parseIso, parseCompact, parseLocale, parseEpoch];

/**
 * Try to extract a timestamp from a media item. Title is checked before the
 * media_content_id; the first pattern that matches wins.
 */
export function parseItemTimestamp(
  title: string,
  mediaContentId: string
): Date | undefined {
  for (const text of [title, mediaContentId]) {
    if (!text) continue;
    for (const parse of PARSERS) {
      const d = parse(text);
      if (d) return d;
    }
  }
  return undefined;
}

const TOKEN_RE = /\[([^\]]*)\]|YYYY|YY|MMM|MM|M|DD|D|d|HH|H|hh|h|mm|m|ss|s|A|a/g;

const months_short = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const days_short = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (n: number) => String(n).padStart(2, "0");

/** Format a date with day.js-style tokens; [brackets] escape literals. */
export function formatDate(date: Date, format: string): string {
  const h12 = date.getHours() % 12 || 12;
  return format.replace(TOKEN_RE, (token, literal: string | undefined) => {
    if (literal !== undefined) return literal;
    switch (token) {
      case "YYYY":
        return String(date.getFullYear());
      case "YY":
        return pad(date.getFullYear() % 100);
      case "MMM":
        return months_short[date.getMonth()];
      case "MM":
        return pad(date.getMonth() + 1);
      case "M":
        return String(date.getMonth() + 1);
      case "DD":
        return pad(date.getDate());
      case "D":
        return String(date.getDate());
      case "d":
        return days_short[date.getDay()];
      case "HH":
        return pad(date.getHours());
      case "H":
        return String(date.getHours());
      case "hh":
        return pad(h12);
      case "h":
        return String(h12);
      case "mm":
        return pad(date.getMinutes());
      case "m":
        return String(date.getMinutes());
      case "ss":
        return pad(date.getSeconds());
      case "s":
        return String(date.getSeconds());
      case "A":
        return date.getHours() < 12 ? "AM" : "PM";
      case "a":
        return date.getHours() < 12 ? "am" : "pm";
      default:
        return token;
    }
  });
}

/**
 * The display title for an item: formatted timestamp when a format is set and
 * a timestamp can be extracted, otherwise the raw title unchanged.
 */
export function formatItemTitle(
  title: string,
  mediaContentId: string,
  format?: string
): string {
  if (!format) return title;
  const date = parseItemTimestamp(title, mediaContentId);
  if (!date) return title;
  return formatDate(date, format);
}
