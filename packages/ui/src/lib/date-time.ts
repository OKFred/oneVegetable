export type DateTimeInput = Date | number | string | null | undefined;

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatDate(value: DateTimeInput, fallback = '—'): string {
  const date = parseDateTime(value);
  if (!date) return fallback;
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
}

export function formatTime(value: DateTimeInput, fallback = '—'): string {
  const date = parseDateTime(value);
  if (!date) return fallback;
  return `${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}:${twoDigits(date.getSeconds())}`;
}

export function formatDateTime(value: DateTimeInput, fallback = '—'): string {
  const date = parseDateTime(value);
  if (!date) return fallback;
  return `${formatDate(date, fallback)} ${formatTime(date, fallback)}`;
}

function parseDateTime(value: DateTimeInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return validDate(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const dateOnly = DATE_ONLY_PATTERN.exec(trimmed);
    if (dateOnly) {
      const year = Number(dateOnly[1]);
      const month = Number(dateOnly[2]);
      const day = Number(dateOnly[3]);
      const parsed = new Date(0);
      parsed.setHours(0, 0, 0, 0);
      parsed.setFullYear(year, month - 1, day);
      return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
        ? parsed
        : null;
    }
    return validDate(new Date(trimmed));
  }
  return validDate(new Date(value));
}

function validDate(value: Date): Date | null {
  return Number.isNaN(value.getTime()) ? null : value;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}
