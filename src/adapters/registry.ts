import { ashbyAdapter } from './ashby';
import { genericAdapter } from './generic';
import { greenhouseAdapter } from './greenhouse';
import { leverAdapter } from './lever';
import { smartRecruitersAdapter } from './smartrecruiters';
import { workableAdapter } from './workable';
import { workdayAdapter } from './workday';
import type { SiteAdapter } from './types';

/**
 * Site adapters, most specific first.
 *
 * Greenhouse leads because it is the one that also matches by DOM signature: its
 * board is frequently embedded in an iframe on a company's own careers domain,
 * where the hostname tells us nothing.
 */
const ADAPTERS: readonly SiteAdapter[] = [
  greenhouseAdapter,
  leverAdapter,
  ashbyAdapter,
  workableAdapter,
  smartRecruitersAdapter,
  workdayAdapter,
];

export function pickAdapter(
  location: Location = window.location,
  doc: Document = document,
): SiteAdapter {
  return ADAPTERS.find((adapter) => adapter.matches(location, doc)) ?? genericAdapter;
}

/** Exposed for tests and diagnostics. */
export const allAdapters = ADAPTERS;
