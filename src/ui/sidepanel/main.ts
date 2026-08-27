import '../shared.css';
import './sidepanel.css';

import { PROFILE_KEYS, USABLE_FIELD_COUNT, filledCount } from '@/storage/schema';
import { loadProfile, onProfileChanged } from '@/storage/profile';
import {
  CLOSED_STAGES,
  listApplications,
  type ApplicationRecord,
} from '@/storage/applications';
import { sendToTab, type FillSummary, type PageDescription } from '@/core/messages';
import { hasAllSiteAccess, requestAllSiteAccess } from '@/storage/permissions';
import { el, must } from '../dom';
import { formatAge, formatExact } from '../format';
import { stageTag } from '../stages';

/**
 * What the "this page" card is currently showing. Set as `data-state` on the
 * card, which is what decides in CSS which action button and which text lines
 * are visible — so there is one place to look for "why is that button showing?"
 * rather than a scatter of `hidden` assignments.
 */
type PageState =
  /** Still asking the tab what it is. */
  | 'checking'
  /** Not a page AutoApply can ever run on — a chrome:// page, a blank tab. */
  | 'no-page'
  /** Chrome will not reveal the URL and every-site access has not been granted. */
  | 'needs-access'
  /** An ordinary web page, but the content script is not answering there. */
  | 'not-running'
  /** Running, but the page has no fillable fields on it. */
  | 'empty-form'
  /** Ready to fill. */
  | 'ready'
  | 'filling'
  | 'filled';

function setState(state: PageState): void {
  must<HTMLElement>('page-card').dataset.state = state;
}

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

// ── this-page card ──────────────────────────────────────────────────────────

let currentTabId: number | null = null;
let currentTabUrl: string | null = null;

/** Renders the result block under the fill button, or clears it. */
function showResult(
  tone: 'ok' | 'warn' | 'error' | null,
  headline = '',
  detail = '',
): void {
  const box = must<HTMLElement>('fill-result');
  if (!tone) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  box.className = `fill-result ${tone}`;
  box.hidden = false;
  box.replaceChildren(
    el('p', { className: 'result-headline', textContent: headline }),
    ...(detail ? [el('p', { className: 'result-detail', textContent: detail })] : []),
  );
}

/**
 * Turns AutoApply on for a site the manifest does not cover.
 *
 * Two steps, both required: Chrome grants the origin only in response to a user
 * gesture, and a permission granted after page load does not retroactively
 * inject the declared content script — so it is injected explicitly.
 */
async function enableOnCurrentSite(): Promise<void> {
  if (currentTabId === null || !currentTabUrl) return;

  let origin: string;
  try {
    origin = `${new URL(currentTabUrl).origin}/*`;
  } catch {
    return;
  }

  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) {
    showResult('warn', 'Permission declined', 'AutoApply stays off for this site.');
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: currentTabId, allFrames: true },
      files: ['content.js'],
    });
  } catch (error) {
    showResult(
      'error',
      'Could not start on this page',
      'Reload the page and try again.',
    );
    console.error('[AutoApply] injection failed', error);
    return;
  }

  showResult(null);
  await refreshPageCard();
}

/**
 * Grants access to every site in one prompt.
 *
 * The browser's own site-access page lists only the six declared job boards, so
 * it cannot be used to add anything else — leaving the per-site flow, which is
 * blocked until the extension can read the URL. This is the way out for someone
 * applying through many different company careers pages. Reversible from the
 * profile page.
 */
async function grantAllSites(): Promise<void> {
  const granted = await requestAllSiteAccess();

  if (!granted) {
    showResult(
      'warn',
      'Declined',
      'AutoApply still works on the six supported job boards.',
    );
    return;
  }

  showResult(null);
  // The content script is not injected retroactively into pages already open.
  if (currentTabId !== null) {
    await chrome.scripting
      .executeScript({ target: { tabId: currentTabId, allFrames: true }, files: ['content.js'] })
      .catch(() => undefined);
  }
  await refreshPageCard();
}

async function refreshPageCard(): Promise<void> {
  const pill = must<HTMLElement>('adapter-pill');
  const role = must<HTMLElement>('page-role');
  const meta = must<HTMLElement>('page-meta');
  const note = must<HTMLElement>('page-note');
  const enable = must<HTMLButtonElement>('enable-button');

  const tab = await activeTab();
  currentTabId = tab?.id ?? null;
  currentTabUrl = tab?.url ?? null;

  const idle = (state: PageState, pillText: string, pillTone: string, noteText: string) => {
    pill.textContent = pillText;
    pill.className = `pill ${pillTone}`.trim();
    note.textContent = noteText;
    setState(state);
  };

  if (!tab?.id) {
    idle('no-page', 'No page', 'warn', 'Open a job application to get started.');
    return;
  }

  // A tab with no readable URL is not an empty tab. Chrome hides `url` for any
  // site the extension has no host permission for, which is every site outside
  // the six supported boards — exactly where "enable on this site" is meant to
  // help. Clicking the toolbar icon grants activeTab for that tab, which makes
  // the URL readable long enough to ask for the origin properly.
  //
  // Chrome redacts the URL of its own pages the same way, though, and no
  // permission will ever reveal them. A user who has already granted every site
  // and is looking at a redacted tab is therefore on chrome://something, where
  // the grant button is not just useless but implies the grant did not work.
  if (!tab.url) {
    if (await hasAllSiteAccess()) {
      idle(
        'no-page',
        'No page',
        'warn',
        'This is one of Chrome’s own pages, which no extension can read. Open a job ' +
          'application to get started.',
      );
      return;
    }
    idle(
      'needs-access',
      'Needs access',
      'warn',
      'Chrome hides this page’s address until AutoApply is allowed here, so it cannot ' +
        'offer to turn on for this one site by name. Granting every site once fixes it ' +
        'for good — you can take it back on the profile page.',
    );
    return;
  }

  if (!/^https?:/.test(tab.url)) {
    idle('no-page', 'No page', 'warn', 'Open a job application to get started.');
    return;
  }

  const description = await sendToTab<PageDescription>(tab.id, { type: 'DESCRIBE_PAGE' });

  if (!description) {
    // With every site already granted the extension does run here — but only on
    // pages opened since the grant, because Chrome does not inject into tabs
    // that were already loaded. Telling that user to "turn it on for this
    // domain" reads as though their grant failed.
    const allSites = await hasAllSiteAccess();
    idle(
      'not-running',
      'Not running',
      'warn',
      allSites
        ? 'AutoApply is allowed on this site but was not running when the page loaded. ' +
            'Start it here, or reload the page.'
        : 'AutoApply runs automatically on Greenhouse, Lever, Ashby, Workable, ' +
            'SmartRecruiters and Workday. On any other site you can turn it on for this ' +
            'domain, and it will use its generic form handling.',
    );
    enable.textContent = allSites
      ? 'Start AutoApply on this page'
      : 'Enable AutoApply on this site';
    return;
  }

  pill.textContent = description.adapter;
  pill.className = 'pill ok';

  // A page with a form but no recognisable posting still fills fine; saying
  // "Application form" is more honest than inventing a title for it.
  role.textContent = description.role || 'Application form';

  const bits: string[] = [];
  if (description.company) bits.push(description.company);
  bits.push(`${description.fieldCount} field${description.fieldCount === 1 ? '' : 's'} detected`);
  if (description.step) {
    bits.push(`step ${description.step.current} of ${description.step.total}`);
  }
  meta.textContent = bits.join(' · ');

  if (description.fieldCount === 0) {
    note.textContent =
      'AutoApply is running here but cannot see any fields to fill. If the form is ' +
      'behind a “Apply” button, open it first.';
    setState('empty-form');
    return;
  }

  setState('ready');
}

async function runFill(): Promise<void> {
  const button = must<HTMLButtonElement>('fill-button');
  if (currentTabId === null) return;

  button.disabled = true;
  setState('filling');
  showResult('ok', 'Filling…');

  const summary = await sendToTab<FillSummary>(currentTabId, { type: 'FILL_PAGE' });
  button.disabled = false;

  if (!summary) {
    setState('ready');
    showResult(
      'error',
      'The page stopped responding',
      'Reload it and try again.',
    );
    return;
  }

  setState('filled');

  const detail = `${summary.skipped} skipped. Review the page, then submit it yourself.`;

  if (summary.requiredUnfilled > 0) {
    showResult(
      'warn',
      `Filled ${summary.filled} — ${summary.requiredUnfilled} required still empty`,
      `${detail} The review panel on the page lists what needs you.`,
    );
  } else if (summary.filled === 0) {
    showResult(
      'warn',
      'Nothing was filled',
      'The review panel on the page explains why each field was skipped.',
    );
  } else {
    showResult('ok', `Filled ${summary.filled} field${summary.filled === 1 ? '' : 's'}`, detail);
  }

  await refreshHistory();
}

// ── profile strip ───────────────────────────────────────────────────────────

async function refreshProfileCard(): Promise<void> {
  const count = must<HTMLElement>('profile-count');
  const meter = must<HTMLElement>('profile-meter');
  const hint = must<HTMLElement>('profile-hint');

  const profile = await loadProfile();
  const filled = filledCount(profile);
  const total = PROFILE_KEYS.length;

  count.textContent = `${filled} of ${total}`;
  meter.style.width = `${Math.round((filled / total) * 100)}%`;
  meter.className =
    `meter-fill ${filled < USABLE_FIELD_COUNT ? 'low' : filled === total ? 'done' : ''}`.trim();

  // Only says something when there is something to do about it. A complete
  // profile does not need to be congratulated every time the panel opens.
  hint.textContent =
    filled === 0
      ? 'Empty — there is nothing to fill forms with yet. Open the profile to add your details.'
      : filled < USABLE_FIELD_COUNT
        ? 'Add more details to cover the fields most applications ask for.'
        : '';
}

// ── history ─────────────────────────────────────────────────────────────────

function historyItem(record: ApplicationRecord): HTMLElement {
  const closed = CLOSED_STAGES.includes(record.stage);
  const item = el('li', { className: `history-item${closed ? ' closed' : ''}` });

  const link = el('a', {
    className: 'history-link',
    href: record.url,
    target: '_blank',
    rel: 'noreferrer',
    title: record.url,
  });

  link.append(
    el('span', {
      className: 'history-role',
      textContent: record.role || record.company || record.host || 'Application',
    }),
  );

  // Company · stage · age. The separators are drawn in CSS rather than added as
  // text nodes, so a screen reader reads three facts instead of interleaving
  // them with "middle dot".
  const meta = el('span', { className: 'history-meta' });
  if (record.company && record.role) {
    meta.append(el('span', { className: 'history-company', textContent: record.company }));
  }
  // The same dot and wording the tracker uses, so a stage is recognisable
  // wherever it turns up.
  meta.append(stageTag(record.stage));
  meta.append(
    el('span', {
      className: 'tabular',
      textContent: formatAge(record.createdAt),
      title: formatExact(record.createdAt),
    }),
  );

  link.append(meta);
  item.append(link);
  return item;
}

/** The panel is narrow — it shows recent activity; the tracker page manages. */
const RECENT_LIMIT = 6;

async function refreshHistory(): Promise<void> {
  const list = must<HTMLUListElement>('history-list');
  const empty = must<HTMLElement>('history-empty');

  const records = await listApplications();
  list.replaceChildren(...records.slice(0, RECENT_LIMIT).map(historyItem));
  empty.hidden = records.length > 0;
}

function openTracker(): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL('tracker.html') });
}

// ── boot ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const openOptions = () => chrome.runtime.openOptionsPage();
  must<HTMLButtonElement>('open-options').addEventListener('click', openOptions);
  must<HTMLButtonElement>('profile-open').addEventListener('click', openOptions);
  must<HTMLButtonElement>('fill-button').addEventListener('click', () => void runFill());
  must<HTMLButtonElement>('enable-button').addEventListener('click', () =>
    void enableOnCurrentSite(),
  );
  must<HTMLButtonElement>('grant-button').addEventListener('click', () => void grantAllSites());
  must<HTMLButtonElement>('open-tracker').addEventListener('click', openTracker);

  // A stage change made on the tracker page should show here without a reopen.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.applications) void refreshHistory();
  });

  // Granting access fires no tab event, so without this the panel keeps showing
  // "Needs access" after the user has already allowed the site — which reads as
  // the extension being broken.
  chrome.permissions.onAdded.addListener(() => void refreshPageCard());
  chrome.permissions.onRemoved.addListener(() => void refreshPageCard());

  // Clicking the toolbar icon is what grants activeTab, and it fires no tab
  // event either — it just focuses this panel. Re-checking on focus is what
  // turns that click into a visible change.
  window.addEventListener('focus', () => void refreshPageCard());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshPageCard();
  });

  onProfileChanged(() => void refreshProfileCard());
  chrome.tabs.onActivated.addListener(() => void refreshPageCard());
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (tabId === currentTabId && change.status === 'complete') void refreshPageCard();
  });

  await Promise.all([refreshPageCard(), refreshProfileCard(), refreshHistory()]);
}

void main();
