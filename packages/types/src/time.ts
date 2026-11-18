import { DateTime, IANAZone } from 'luxon';

export function isBusinessTimeZone(value: string): boolean {
  return value === 'UTC' || IANAZone.isValidZone(value);
}

export function businessLocalInput(iso: string, timeZone: string): string {
  const date = DateTime.fromISO(iso, { zone: timeZone });
  if (!date.isValid) throw new RangeError('Invalid time or business time zone.');
  return date.toFormat("yyyy-MM-dd'T'HH:mm");
}

export function businessLocalToUtc(value: string, timeZone: string): string {
  if (!isBusinessTimeZone(timeZone)) throw new RangeError('Choose a valid business time zone.');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new RangeError('Enter a date and time.');
  const date = DateTime.fromISO(value, { zone: timeZone });
  if (!date.isValid || date.toFormat("yyyy-MM-dd'T'HH:mm") !== value) {
    throw new RangeError(
      'This local time does not exist because of a clock change. Choose another time.',
    );
  }
  if (date.getPossibleOffsets().length > 1) {
    throw new RangeError(
      'This local time occurs twice during a clock change. Choose an unambiguous time.',
    );
  }
  const iso = date.toUTC().toISO();
  if (!iso) throw new RangeError('Unable to convert the selected time.');
  return iso;
}

export function formatBusinessTime(iso: string, timeZone: string): string {
  if (!isBusinessTimeZone(timeZone)) throw new RangeError('Invalid business time zone.');
  const date = DateTime.fromISO(iso, { zone: timeZone });
  if (!date.isValid) throw new RangeError('Invalid date and time.');
  return date.toFormat("LLL d, yyyy 'at' h:mm a ZZZZ");
}

export function followUpBucket(
  dueAt: string,
  timeZone: string,
  now: string,
): 'overdue' | 'today' | 'upcoming' {
  const due = DateTime.fromISO(dueAt, { zone: timeZone });
  const current = DateTime.fromISO(now, { zone: timeZone });
  if (!due.isValid || !current.isValid) throw new RangeError('Invalid follow-up date.');
  if (due.toMillis() < current.toMillis()) return 'overdue';
  return due.hasSame(current, 'day') ? 'today' : 'upcoming';
}
