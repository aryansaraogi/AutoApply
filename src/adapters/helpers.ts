/**
 * Shared building blocks for site adapters.
 *
 * Adapter selectors are best-effort: ATS vendors reskin their markup without
 * notice, so every helper here returns a falsy value rather than throwing when
 * a selector misses. The content script layers adapter output over the generic
 * heuristics, so a stale selector degrades to the generic path instead of
 * breaking the fill.
 */

import { visibleTextOf } from '@/core/normalize';
import { cleanCompany } from '@/core/jobMeta';

/** First non-empty match from a list of candidate selectors. */
export function textFrom(doc: Document, selectors: readonly string[], maxLength = 140): string {
  for (const selector of selectors) {
    const node = doc.querySelector(selector);
    if (!node) continue;
    const text = visibleTextOf(node);
    if (text && text.length <= maxLength) return text;
  }
  return '';
}

/**
 * Most ATS URLs put the employer in the first path segment
 * ("jobs.lever.co/acme/…"), which is the one company signal that survives a
 * redesign.
 */
export function companyFromPath(location: Location, index = 0): string {
  const segments = location.pathname.split('/').filter(Boolean);
  const segment = segments[index];
  if (!segment || segment.length > 60) return '';
  // Greenhouse embeds live at /embed/job_app, so the first segment is the word
  // "embed" — cleanCompany rejects routing words like that rather than titling
  // them into a plausible-looking employer name.
  return cleanCompany(titleCase(segment));
}

export function titleCase(slug: string): string {
  return slug
    .replace(/[-_+]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .trim();
}

/** Picks the form with the most controls, ignoring search and newsletter forms. */
export function largestForm(doc: Document, minControls = 3): ParentNode | null {
  let best: HTMLFormElement | null = null;
  let bestCount = 0;

  for (const form of doc.querySelectorAll('form')) {
    const count = form.querySelectorAll('input, select, textarea, [contenteditable="true"]').length;
    if (count > bestCount) {
      best = form;
      bestCount = count;
    }
  }

  return bestCount >= minControls ? best : null;
}

/** Resolves the first selector that exists, else the largest form, else the document. */
export function formRootFrom(doc: Document, selectors: readonly string[]): ParentNode {
  for (const selector of selectors) {
    const node = doc.querySelector(selector);
    if (node) return node;
  }
  return largestForm(doc) ?? doc;
}

export function hostMatches(location: Location, suffixes: readonly string[]): boolean {
  const host = location.hostname.toLowerCase();
  return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}
