/**
 * Content script: the only context that touches the page.
 *
 * Runs in every frame (the manifest declares all_frames), because Greenhouse and
 * friends embed the application in an iframe. To keep that from producing a
 * chorus of replies, a frame only answers when it can actually see form fields —
 * so the frame holding the application is the one that responds.
 */

import { pickAdapter } from '@/adapters/registry';
import { fillFields } from '@/core/fill';
import { harvest } from '@/core/harvest';
import { extractJobMeta } from '@/core/jobMeta';
import { sendToBackground, type FillSummary, type PageDescription, type ToContent } from '@/core/messages';
import { DEFAULT_FILL_OPTIONS, type FieldDescriptor } from '@/core/types';
import { loadProfile } from '@/storage/profile';
import { filledCount } from '@/storage/schema';
import { defaultResume, getResumeBytes } from '@/storage/resumes';
import { loadSettings } from '@/storage/settings';
import { showOverlay } from '@/ui/overlay';
import type { ResumePayload } from '@/core/attach';

/**
 * Reads the résumé to attach, bytes included. Only called at fill time — the
 * file body is the one large thing in storage and there is no reason to hold it
 * in a page's memory otherwise.
 */
async function loadResumePayload(): Promise<ResumePayload | null> {
  const meta = await defaultResume();
  if (!meta) return null;
  const bytes = await getResumeBytes(meta.id);
  if (!bytes) return null;
  return { filename: meta.filename, mimeType: meta.mimeType, bytes };
}

const adapter = pickAdapter();

function harvestPage(): FieldDescriptor[] {
  const root = adapter.formRoot?.(document) ?? document;
  return harvest(root);
}

function describePage(): PageDescription {
  const generic = extractJobMeta(document, window.location);
  const specific = adapter.jobMeta?.(document, window.location) ?? {};

  return {
    adapter: adapter.name,
    company: specific.company || generic.company,
    role: specific.role || generic.role,
    url: pageUrl(),
    fieldCount: harvestPage().length,
    step: adapter.step?.(document) ?? null,
  };
}

/**
 * The URL worth recording. Inside an embedded application frame, the frame's own
 * URL is an opaque board URL; the page the user actually opened is the referrer.
 */
function pageUrl(): string {
  if (window.top === window.self) return location.href;
  try {
    // Same-origin parents let us read the real thing; cross-origin throws.
    const topUrl = window.top?.location.href;
    if (topUrl) return topUrl;
  } catch {
    /* cross-origin parent — fall through to the referrer */
  }
  return document.referrer || location.href;
}

// ── filling ─────────────────────────────────────────────────────────────────

/** Set once a fill has happened, so submit detection knows what to promote. */
let recordId: string | null = null;

async function runFill(): Promise<FillSummary> {
  const [profile, settings, resume] = await Promise.all([
    loadProfile(),
    loadSettings(),
    loadResumePayload(),
  ]);
  const fields = harvestPage();

  const result = await fillFields(
    fields,
    profile,
    DEFAULT_FILL_OPTIONS,
    adapter.fillField ? (field, value) => adapter.fillField!(field, value) : undefined,
    resume,
  );

  // "0 filled, 28 skipped" reads as a broken extension when the real cause is
  // an empty profile. Say which it is.
  const profileIsEmpty = filledCount(profile) === 0;

  showOverlay({
    profileIsEmpty,
    reports: result.reports,
    fields: new Map(fields.map((field) => [field.id, field])),
    filled: result.filled,
    skipped: result.skipped,
    requiredUnfilled: result.requiredUnfilled,
    highlight: settings.highlightFills,
  });

  const description = describePage();

  const response = await sendToBackground<{ ok: boolean; id?: string }>({
    type: 'RECORD_FILL',
    event: {
      company: description.company,
      role: description.role,
      url: description.url,
      fieldsFilled: result.filled,
      fieldsSkipped: result.skipped,
    },
  });

  if (response?.id) {
    recordId = response.id;
    if (settings.trackSubmissions) watchForSubmit();
  }

  return {
    company: description.company,
    role: description.role,
    url: description.url,
    adapter: adapter.name,
    filled: result.filled,
    skipped: result.skipped,
    requiredUnfilled: result.requiredUnfilled,
  };
}

// ── submit detection ────────────────────────────────────────────────────────

const SUBMIT_LABEL = /\b(submit|apply|send application|finish)\b/i;

let watching = false;

/**
 * Best-effort promotion of a history entry from "filled" to "submitted".
 *
 * Listens for a real form submit and for clicks on submit-looking buttons. An
 * app that posts via fetch and re-renders without either signal will stay at
 * "filled" — the history view labels the status as best-effort for that reason.
 */
function watchForSubmit(): void {
  if (watching) return;
  watching = true;

  const promote = () => {
    if (!recordId) return;
    void sendToBackground({ type: 'MARK_SUBMITTED', id: recordId });
    stop();
  };

  const onSubmit = () => promote();

  const onClick = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('button, input[type="submit"], [role="button"]');
    if (!button) return;

    const text = (button.textContent ?? '') + ' ' + (button.getAttribute('value') ?? '');
    if (SUBMIT_LABEL.test(text)) promote();
  };

  function stop() {
    watching = false;
    document.removeEventListener('submit', onSubmit, true);
    document.removeEventListener('click', onClick, true);
  }

  document.addEventListener('submit', onSubmit, true);
  document.addEventListener('click', onClick, true);
}

// ── messaging ───────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: ToContent, _sender, sendResponse) => {
  // Staying silent in field-less frames means the sidepanel's single response
  // comes from the frame that actually holds the application.
  const hasFields = harvestPage().length > 0;

  switch (message.type) {
    case 'PING':
      if (!hasFields) return false;
      sendResponse({ ok: true });
      return false;

    case 'DESCRIBE_PAGE':
      if (!hasFields) return false;
      sendResponse(describePage());
      return false;

    case 'FILL_PAGE':
      if (!hasFields) return false;
      runFill()
        .then(sendResponse)
        .catch((error: unknown) => {
          console.error('[AutoApply] fill failed', error);
          sendResponse(null);
        });
      return true; // async response

    default:
      return false;
  }
});
