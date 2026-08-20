import { describe, expect, test } from "bun:test";
import { latestOccurrence, nextOccurrence, parseScheduleTimes, validTimezone } from "../../server/clock";

describe("parseScheduleTimes", () => {
  test("normalizes, dedupes, sorts", () => {
    expect(parseScheduleTimes("7:00, 19:5")).toEqual(["07:00", "19:05"]);
    expect(parseScheduleTimes("19:00, 07:00, 19:00")).toEqual(["07:00", "19:00"]);
  });
  test("rejects junk, out-of-range, too many", () => {
    expect(parseScheduleTimes("")).toBeNull();
    expect(parseScheduleTimes("7am")).toBeNull();
    expect(parseScheduleTimes("24:00")).toBeNull();
    expect(parseScheduleTimes("07:60")).toBeNull();
    expect(parseScheduleTimes(Array.from({ length: 9 }, (_, i) => `0${i % 10}:00`).join(","))).toBeNull();
  });
});

describe("validTimezone", () => {
  test("accepts IANA names, rejects junk", () => {
    expect(validTimezone("Asia/Jakarta")).toBe(true);
    expect(validTimezone("UTC")).toBe(true);
    expect(validTimezone("Mars/OlympusMons")).toBe(false);
  });
});

describe("occurrences (Asia/Jakarta, UTC+7, no DST)", () => {
  const TZ = "Asia/Jakarta";
  // 2026-08-20 12:00 Jakarta = 05:00 UTC
  const NOON_JAKARTA = Date.UTC(2026, 7, 20, 5, 0);

  test("latest occurrence of an earlier time is today", () => {
    // 07:00 Jakarta today = 00:00 UTC
    expect(latestOccurrence(["07:00"], TZ, NOON_JAKARTA)).toBe(Date.UTC(2026, 7, 20, 0, 0));
  });

  test("latest occurrence of a later time is yesterday", () => {
    // 19:00 Jakarta yesterday = 2026-08-19 12:00 UTC
    expect(latestOccurrence(["19:00"], TZ, NOON_JAKARTA)).toBe(Date.UTC(2026, 7, 19, 12, 0));
  });

  test("multiple times pick the most recent past one", () => {
    expect(latestOccurrence(["07:00", "19:00"], TZ, NOON_JAKARTA)).toBe(Date.UTC(2026, 7, 20, 0, 0));
  });

  test("next occurrence is the soonest future one", () => {
    // next after noon: 19:00 today = 12:00 UTC
    expect(nextOccurrence(["07:00", "19:00"], TZ, NOON_JAKARTA)).toBe(Date.UTC(2026, 7, 20, 12, 0));
    // only 07:00 → tomorrow 00:00 UTC
    expect(nextOccurrence(["07:00"], TZ, NOON_JAKARTA)).toBe(Date.UTC(2026, 7, 21, 0, 0));
  });

  test("an occurrence exactly now counts as latest, not next", () => {
    const at1900 = Date.UTC(2026, 7, 20, 12, 0);
    expect(latestOccurrence(["19:00"], TZ, at1900)).toBe(at1900);
    expect(nextOccurrence(["19:00"], TZ, at1900)).toBe(at1900 + 24 * 60 * 60 * 1000);
  });
});

describe("occurrences (America/New_York, DST)", () => {
  const TZ = "America/New_York";
  test("summer offset is UTC-4", () => {
    // 2026-08-20 09:00 New York = 13:00 UTC
    const now = Date.UTC(2026, 7, 20, 14, 0); // 10:00 NY
    expect(latestOccurrence(["09:00"], TZ, now)).toBe(Date.UTC(2026, 7, 20, 13, 0));
  });
  test("winter offset is UTC-5", () => {
    // 2026-01-20 09:00 New York = 14:00 UTC
    const now = Date.UTC(2026, 0, 20, 15, 0); // 10:00 NY
    expect(latestOccurrence(["09:00"], TZ, now)).toBe(Date.UTC(2026, 0, 20, 14, 0));
  });
});
