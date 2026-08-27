import { describe, expect, it } from 'vitest';
import {
  STALE_AFTER_DAYS,
  daysSince,
  formatAge,
  formatStageAge,
} from '@/ui/format';

/**
 * These drive two things the user reads as facts about their own job search —
 * "applied 3 weeks ago" and "sitting in Screening for a month" — so the day
 * arithmetic has to be right at the boundaries rather than approximately right.
 */

/** A fixed "now" so nothing here depends on when the suite runs. */
const NOW = new Date('2026-08-27T14:30:00').getTime();
const DAY = 24 * 60 * 60 * 1000;

/** `days` whole days before NOW, at the same time of day. */
const ago = (days: number): number => NOW - days * DAY;

describe('daysSince', () => {
  it('counts whole days from local midnight, so "yesterday" is 1 all day', () => {
    // Late last night and early yesterday morning are both "1 day ago", even
    // though one is 15 hours back and the other is 32.
    const lastNight = new Date('2026-08-26T23:50:00').getTime();
    const yesterdayMorning = new Date('2026-08-26T06:10:00').getTime();
    expect(daysSince(lastNight, NOW)).toBe(1);
    expect(daysSince(yesterdayMorning, NOW)).toBe(1);
  });

  it('treats anything earlier today as zero days', () => {
    expect(daysSince(new Date('2026-08-27T00:01:00').getTime(), NOW)).toBe(0);
    expect(daysSince(NOW, NOW)).toBe(0);
  });

  it('never goes negative for a timestamp in the future', () => {
    // Clock changes and imported records can both produce one.
    expect(daysSince(NOW + 5 * DAY, NOW)).toBe(0);
  });

  it('is unaffected by a daylight-saving shift', () => {
    // US DST ended 2 Nov 2025; that day is 25 hours long.
    const before = new Date('2025-10-30T12:00:00').getTime();
    const after = new Date('2025-11-06T12:00:00').getTime();
    expect(daysSince(before, after)).toBe(7);
  });
});

describe('formatAge', () => {
  it('reads as a compact age, not a duration', () => {
    expect(formatAge(NOW, NOW)).toBe('today');
    expect(formatAge(ago(1), NOW)).toBe('1d');
    expect(formatAge(ago(6), NOW)).toBe('6d');
  });

  it('switches unit rather than letting the number grow', () => {
    expect(formatAge(ago(7), NOW)).toBe('1w');
    expect(formatAge(ago(30), NOW)).toBe('4w');
    expect(formatAge(ago(90), NOW)).toBe('3mo');
    expect(formatAge(ago(400), NOW)).toBe('1.1y');
  });

  it('stays short enough for a table cell at every scale', () => {
    for (const days of [0, 1, 3, 7, 20, 55, 60, 200, 364, 365, 900]) {
      expect(formatAge(ago(days), NOW).length).toBeLessThanOrEqual(5);
    }
  });
});

describe('formatStageAge', () => {
  it('spells the unit out, since it is read as a sentence', () => {
    expect(formatStageAge(NOW, NOW)).toBe('today');
    expect(formatStageAge(ago(1), NOW)).toBe('1 day');
    expect(formatStageAge(ago(9), NOW)).toBe('9 days');
    expect(formatStageAge(ago(21), NOW)).toBe('3 weeks');
    expect(formatStageAge(ago(90), NOW)).toBe('3 months');
  });

  it('says "1 day", never "1 days"', () => {
    expect(formatStageAge(ago(1), NOW)).not.toContain('days');
  });
});

describe('the staleness threshold', () => {
  it('is reached exactly at the boundary, not a day either side', () => {
    // The tracker flags a record when daysSince >= STALE_AFTER_DAYS, so an
    // off-by-one here would either nag a day early or miss the whole point.
    expect(daysSince(ago(STALE_AFTER_DAYS - 1), NOW) >= STALE_AFTER_DAYS).toBe(false);
    expect(daysSince(ago(STALE_AFTER_DAYS), NOW) >= STALE_AFTER_DAYS).toBe(true);
    expect(daysSince(ago(STALE_AFTER_DAYS + 1), NOW) >= STALE_AFTER_DAYS).toBe(true);
  });
});
