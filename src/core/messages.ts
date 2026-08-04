/**
 * The message contract between the three extension contexts: extension pages
 * (options / sidepanel), the service worker, and the content script.
 *
 * Everything is funnelled through one discriminated union so a typo in a message
 * name is a compile error rather than a silently dropped message.
 */

import type { FillEvent } from '@/storage/applications';

/** What a fill pass did, as reported back to whoever asked for it. */
export interface FillSummary {
  company: string;
  role: string;
  url: string;
  adapter: string;
  filled: number;
  skipped: number;
  /** Fields the form marks required that we could not answer — the ones the
   *  user genuinely has to look at before submitting. */
  requiredUnfilled: number;
}

/** Sent by extension pages to a tab's content script. */
export type ToContent =
  | { type: 'PING' }
  | { type: 'FILL_PAGE' }
  | { type: 'DESCRIBE_PAGE' };

/** Sent by the content script to the service worker. */
export type ToBackground =
  | { type: 'RECORD_FILL'; event: FillEvent }
  | { type: 'MARK_SUBMITTED'; id: string };

export type Message = ToContent | ToBackground;

export interface PageDescription {
  adapter: string;
  company: string;
  role: string;
  url: string;
  /** Fillable fields the harvester can see right now. */
  fieldCount: number;
  /** Position in a multi-page wizard, where the ATS has one. */
  step: { current: number; total: number } | null;
}

/**
 * Sends a message to a tab. Resolves to null when no content script is listening
 * (wrong page, script not injected yet, or the tab was closed) rather than
 * rejecting — "nobody home" is an expected state, not an error.
 */
export async function sendToTab<T>(tabId: number, message: ToContent): Promise<T | null> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T;
  } catch {
    return null;
  }
}

export async function sendToBackground<T>(message: ToBackground): Promise<T | null> {
  try {
    return (await chrome.runtime.sendMessage(message)) as T;
  } catch {
    return null;
  }
}
