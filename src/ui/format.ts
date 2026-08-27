/**
 * Date formatting shared by the tracker and the side panel.
 *
 * Everything here uses the browser's own locale rather than a fixed format —
 * these are the user's own records, read on their own machine, so there is no
 * second party whose conventions need accommodating.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** "27 Aug 2026" — the absolute date, for anything being scanned in a column. */
export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Full date and time, for the tooltip behind a shortened date. */
export function formatExact(ms: number): string {
  return new Date(ms).toLocaleString();
}

/** Whole days elapsed, counting from local midnight so "yesterday" is 1 all day. */
export function daysSince(ms: number, now: number = Date.now()): number {
  const start = new Date(ms);
  start.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today.getTime() - start.getTime()) / DAY_MS));
}

/**
 * "today", "3d", "5w", "8mo" — a compact age for a dense list.
 *
 * Deliberately short: this sits inside a table cell and next to a job title in a
 * 320px panel, where "3 months ago" would push the title into an ellipsis.
 */
export function formatAge(ms: number, now: number = Date.now()): string {
  const days = daysSince(ms, now);
  if (days === 0) return 'today';
  if (days === 1) return '1d';
  if (days < 7) return `${days}d`;
  if (days < 56) return `${Math.round(days / 7)}w`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  const years = Math.round((days / 365) * 10) / 10;
  return `${years}y`;
}

/**
 * How long an application has sat where it is — "in Interview for 3 weeks".
 *
 * `stageChangedAt` has always been recorded for exactly this, but nothing
 * displayed it, so the one question a job tracker exists to answer ("what has
 * gone quiet?") could not be answered from the tracker.
 */
export function formatStageAge(stageChangedAt: number, now: number = Date.now()): string {
  const days = daysSince(stageChangedAt, now);
  if (days === 0) return 'today';
  if (days === 1) return '1 day';
  if (days < 14) return `${days} days`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days / 30)} months`;
}

/** Stages left alone this long are worth a nudge in the tracker. */
export const STALE_AFTER_DAYS = 21;
