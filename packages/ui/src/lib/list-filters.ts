/** Preserve the platform's wall-clock semantics; never invent an IANA time zone. */
export function platformDateFilter(value: string, end = false): string {
  if (!value) return '';
  const date = value.replace('T', ' ');
  return date.length === 16 ? `${date}:${end ? '59' : '00'}` : date;
}

export function validFilterRange(start: string, end: string): boolean {
  return (
    (!start || validFilterDate(start)) &&
    (!end || validFilterDate(end)) &&
    (!start || !end || platformDateFilter(start) <= platformDateFilter(end, true))
  );
}

export function validFilterDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/u.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number);
  const second = Number(match[6] ?? 0);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  )
    return false;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  );
}
