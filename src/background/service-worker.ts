/**
 * Service worker: message router and the only place that writes the application
 * log. Content scripts ask it to record fills rather than touching storage
 * directly, so concurrent frames on the same page cannot clobber each other's
 * read-modify-write.
 */

import type { ToBackground } from '@/core/messages';
import { markSubmitted, recordFill } from '@/storage/applications';

// Clicking the toolbar icon opens the side panel. Set once per worker start;
// the API throws on Chrome builds older than 114, which we do not support.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error: unknown) => console.warn('[AutoApply] side panel unavailable', error));

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') void chrome.runtime.openOptionsPage();
});

/**
 * Storage writes are serialised through this chain. Two frames of the same
 * Greenhouse page can finish filling within milliseconds of each other, and
 * chrome.storage has no transactions.
 */
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

chrome.runtime.onMessage.addListener((message: ToBackground, _sender, sendResponse) => {
  switch (message.type) {
    case 'RECORD_FILL':
      serialize(() => recordFill(message.event))
        .then((id) => sendResponse({ ok: true, id }))
        .catch((error: unknown) => {
          console.error('[AutoApply] failed to record fill', error);
          sendResponse({ ok: false });
        });
      return true; // keep the channel open for the async response

    case 'MARK_SUBMITTED':
      serialize(() => markSubmitted(message.id))
        .then(() => sendResponse({ ok: true }))
        .catch((error: unknown) => {
          console.error('[AutoApply] failed to mark submitted', error);
          sendResponse({ ok: false });
        });
      return true;

    default:
      return false;
  }
});
