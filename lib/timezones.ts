// Curated IANA time zones for the Settings picker. Kept short and friendly so
// the region selector stays clean — US zones first (the primary audience), then
// the common international ones. Every value is a real IANA identifier that
// Intl.DateTimeFormat understands.

export interface TimeZoneOption {
  value: string; // IANA identifier
  label: string; // friendly, human label
  group: string; // used to render <optgroup>s
}

export const TIME_ZONE_OPTIONS: TimeZoneOption[] = [
  // United States
  { value: 'America/New_York',    label: 'Eastern Time — New York, Toledo, Detroit', group: 'United States' },
  { value: 'America/Chicago',     label: 'Central Time — Chicago, Dallas',            group: 'United States' },
  { value: 'America/Denver',      label: 'Mountain Time — Denver, Salt Lake City',    group: 'United States' },
  { value: 'America/Phoenix',     label: 'Mountain Time (no DST) — Phoenix',          group: 'United States' },
  { value: 'America/Los_Angeles', label: 'Pacific Time — Los Angeles, Seattle',       group: 'United States' },
  { value: 'America/Anchorage',   label: 'Alaska Time — Anchorage',                   group: 'United States' },
  { value: 'Pacific/Honolulu',    label: 'Hawaii Time — Honolulu',                    group: 'United States' },

  // Americas
  { value: 'America/Toronto',     label: 'Toronto',        group: 'Americas' },
  { value: 'America/Mexico_City', label: 'Mexico City',    group: 'Americas' },
  { value: 'America/Sao_Paulo',   label: 'São Paulo',      group: 'Americas' },

  // Europe & Africa
  { value: 'Europe/London',       label: 'London',         group: 'Europe & Africa' },
  { value: 'Europe/Paris',        label: 'Paris, Berlin',  group: 'Europe & Africa' },
  { value: 'Europe/Moscow',       label: 'Moscow',         group: 'Europe & Africa' },
  { value: 'Africa/Cairo',        label: 'Cairo',          group: 'Europe & Africa' },
  { value: 'Africa/Lagos',        label: 'Lagos',          group: 'Europe & Africa' },

  // Asia & Pacific
  { value: 'Asia/Dubai',          label: 'Dubai',          group: 'Asia & Pacific' },
  { value: 'Asia/Kolkata',        label: 'India — Kolkata, Mumbai', group: 'Asia & Pacific' },
  { value: 'Asia/Ho_Chi_Minh',    label: 'Ho Chi Minh City', group: 'Asia & Pacific' },
  { value: 'Asia/Singapore',      label: 'Singapore',      group: 'Asia & Pacific' },
  { value: 'Asia/Shanghai',       label: 'Shanghai, Beijing', group: 'Asia & Pacific' },
  { value: 'Asia/Tokyo',          label: 'Tokyo',          group: 'Asia & Pacific' },
  { value: 'Australia/Sydney',    label: 'Sydney',         group: 'Asia & Pacific' },
  { value: 'Pacific/Auckland',    label: 'Auckland',       group: 'Asia & Pacific' },
];

// Order the groups render in.
export const TIME_ZONE_GROUPS = ['United States', 'Americas', 'Europe & Africa', 'Asia & Pacific'];

/**
 * Return the browser's IANA zone if we can read it, else undefined. Used to
 * offer a one-tap "use my detected zone" default.
 */
export function detectTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** Friendly label for a stored zone value (falls back to the raw id). */
export function timeZoneLabel(value: string): string {
  return TIME_ZONE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}
