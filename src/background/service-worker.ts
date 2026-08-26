/**
 * Service worker: message router, and the owner of the content script
 * registration that follows the user's site-access choice.
 *
 * Content scripts ask it to record fills rather than writing the application log
 * from the page, so a Greenhouse form and its embedded frame cannot both append
 * a record for the same fill.
 */

import type { ToBackground } from '@/core/messages';
import { markSubmitted, recordFill } from '@/storage/applications';
import { hasAllSiteAccess } from '@/storage/permissions';

// Clicking the toolbar icon opens the side panel. Set once per worker start;
// the API throws on Chrome builds older than 114, which we do not support.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error: unknown) => console.warn('[AutoApply] side panel unavailable', error));

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') void chrome.runtime.openOptionsPage();
  void syncGenericScript();
});

chrome.runtime.onStartup.addListener(() => void syncGenericScript());

// ── site access ─────────────────────────────────────────────────────────────

/** The all-sites registration, kept distinct from the manifest's six boards. */
const GENERIC_SCRIPT_ID = 'autoapply-generic';

/**
 * Keeps the generic content script registration in step with the all-sites
 * permission.
 *
 * The manifest can only declare the six boards it ships with; a permission
 * granted later does not retroactively make Chrome inject anywhere. Without
 * this, "Allow AutoApply on every site" removed the permission prompt but the
 * user still had to press "Enable on this site" on every page — the grant
 * bought them nothing they could see.
 *
 * The declared hosts are excluded, because a frame that received both
 * registrations would answer FILL_PAGE twice and fill the form twice over.
 */
async function syncGenericScript(): Promise<void> {
  try {
    const wanted = await hasAllSiteAccess();
    const registered = await chrome.scripting.getRegisteredContentScripts({
      ids: [GENERIC_SCRIPT_ID],
    });

    if (wanted && registered.length === 0) {
      const declared = chrome.runtime.getManifest().content_scripts?.[0];
      await chrome.scripting.registerContentScripts([
        {
          id: GENERIC_SCRIPT_ID,
          js: ['content.js'],
          matches: ['https://*/*', 'http://*/*'],
          excludeMatches: declared?.matches ?? [],
          allFrames: true,
          runAt: 'document_idle',
          persistAcrossSessions: true,
        },
      ]);
    } else if (!wanted && registered.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: [GENERIC_SCRIPT_ID] });
    }
  } catch (error: unknown) {
    console.warn('[AutoApply] could not sync the generic content script', error);
  }
}

chrome.permissions.onAdded.addListener(() => void syncGenericScript());
chrome.permissions.onRemoved.addListener(() => void syncGenericScript());

// A worker that restarts mid-session should not lose the registration either.
void syncGenericScript();

// ── messages ────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: ToBackground, _sender, sendResponse) => {
  switch (message.type) {
    case 'RECORD_FILL':
      recordFill(message.event)
        .then((id) => sendResponse({ ok: true, id }))
        .catch((error: unknown) => {
          console.error('[AutoApply] failed to record fill', error);
          sendResponse({ ok: false });
        });
      return true; // keep the channel open for the async response

    case 'MARK_SUBMITTED':
      markSubmitted(message.id)
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
