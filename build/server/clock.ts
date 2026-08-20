// Timezone-aware clock-schedule math for sources with explicit times of day
// ("07:00, 19:00" in the owner's timezone). Pure functions, no state — the
// scheduler asks "when did/does HH:MM last/next occur in this zone?" and
// compares against last_fetched_at. DST handled via Intl (no dependencies).

export function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const MAX_SCHEDULE_TIMES = 8;

/** Normalize "7:00, 19:5" → ["07:00","19:05"]; null when invalid. */
export function parseScheduleTimes(input: string): string[] | null {
  const parts = input.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > MAX_SCHEDULE_TIMES) return null;
  const times: string[] = [];
  for (const part of parts) {
    const match = part.match(/^(\d{1,2}):(\d{1,2})$/);
    if (!match) return null;
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (h > 23 || m > 59) return null;
    times.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
  return [...new Set(times)].sort();
}

/** The zone's UTC offset (ms) at a given instant. */
function tzOffsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Epoch ms for a wall-clock date+time in a zone (DST-corrected by iteration). */
function localToEpoch(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const epoch = guess - tzOffsetMs(guess, tz);
  return guess - tzOffsetMs(epoch, tz); // second pass settles DST boundaries
}

function localDate(utcMs: number, tz: string): { y: number; mo: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { y: get("year"), mo: get("month"), d: get("day") };
}

function occurrenceOn(dayAnchorMs: number, time: string, tz: string): number {
  const { y, mo, d } = localDate(dayAnchorMs, tz);
  const [h, mi] = time.split(":").map(Number);
  return localToEpoch(y, mo, d, h, mi, tz);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Most recent occurrence (epoch ms) of any of the times, at or before `nowMs`. */
export function latestOccurrence(times: string[], tz: string, nowMs: number): number {
  let latest = -Infinity;
  for (const time of times) {
    // Check today and yesterday (in the zone) — one of them holds the latest past occurrence.
    for (const anchor of [nowMs, nowMs - DAY_MS]) {
      const occurrence = occurrenceOn(anchor, time, tz);
      if (occurrence <= nowMs && occurrence > latest) latest = occurrence;
    }
  }
  return latest;
}

/** Next occurrence (epoch ms) of any of the times, strictly after `nowMs`. */
export function nextOccurrence(times: string[], tz: string, nowMs: number): number {
  let next = Infinity;
  for (const time of times) {
    for (const anchor of [nowMs, nowMs + DAY_MS]) {
      const occurrence = occurrenceOn(anchor, time, tz);
      if (occurrence > nowMs && occurrence < next) next = occurrence;
    }
  }
  return next;
}
