import type { FillOverride } from '@/core/fill';
import type { JobMeta } from '@/core/jobMeta';

/**
 * A site adapter absorbs one ATS's quirks.
 *
 * Deliberately narrow: an adapter may change *where* we look and *how* a widget
 * is driven, but never *what value goes where* — that stays in the shared rule
 * table so a fix for one site benefits all of them.
 */
export interface SiteAdapter {
  /** Shown in the sidepanel so the user knows which path is running. */
  name: string;

  /** Whether this adapter should handle the current page. */
  matches(location: Location, doc: Document): boolean;

  /** Narrows the harvest to the application form. Defaults to the whole document. */
  formRoot?(doc: Document): ParentNode | null;

  /** Drives a control the generic engine cannot. Return null to fall through. */
  fillField?: FillOverride;

  /**
   * Better company/role than the generic heuristics can manage. Location is
   * passed in rather than read off `doc` so it stays consistent with matches()
   * and so callers can resolve metadata for a URL other than the live document.
   */
  jobMeta?(doc: Document, location: Location): Partial<JobMeta>;

  /** Progress through a multi-page wizard, when the ATS has one. */
  step?(doc: Document): { current: number; total: number } | null;
}
