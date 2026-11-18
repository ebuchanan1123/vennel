'use client';

import { useClientReady } from '../lib/use-client-ready';

const commonTimeZones = [
  'UTC',
  'America/Toronto',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Australia/Sydney',
];

export function TimeZoneSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const ready = useClientReady();
  // Server and browser Intl data can differ, so expand the list after hydration.
  const zones = new Set([
    ...commonTimeZones,
    ...(ready ? Intl.supportedValuesOf('timeZone') : []),
    value,
  ]);

  return (
    <select
      className="field"
      required
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {Array.from(zones, (zone) => (
        <option key={zone} value={zone}>
          {zone}
        </option>
      ))}
    </select>
  );
}
