/**
 * Service worker: message router and the only place that writes the application
 * log. Content scripts ask it to record fills rather than touching storage
 * directly, so concurrent frames on the same page cannot clobber each other's
 * read-modify-write.
 */

import { anthropicProvider } from '@/ai/anthropic';
import type { AiQuestion } from '@/ai/provider';
import type { AiAnswerResponse, ToBackground } from '@/core/messages';
import { markSubmitted, recordFill } from '@/storage/applications';
import { loadProfile } from '@/storage/profile';
import { loadApiKey, loadSettings } from '@/storage/settings';

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

    case 'AI_ANSWER':
      answerWithAi(message.questions)
        .then(sendResponse)
        .catch((error: unknown) => {
          console.error('[AutoApply] AI assist failed', error);
          sendResponse({ ok: false, error: describeError(error) });
        });
      return true;

    default:
      return false;
  }
});

/**
 * The only place the API key is read. Content scripts share a page with
 * untrusted script, so the key stays here and only answers cross back.
 */
async function answerWithAi(questions: AiQuestion[]): Promise<AiAnswerResponse> {
  const [settings, apiKey, profile] = await Promise.all([
    loadSettings(),
    loadApiKey(),
    loadProfile(),
  ]);

  if (!settings.aiEnabled) return { ok: false, error: 'AI assist is switched off.' };
  if (!apiKey) return { ok: false, error: 'No API key saved. Add one in the profile page.' };

  const answers = await anthropicProvider({
    profile,
    questions,
    model: settings.aiModel,
    apiKey,
  });

  return { ok: true, answers };
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'The request failed.';
}
