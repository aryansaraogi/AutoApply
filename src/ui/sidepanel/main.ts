import '../shared.css';
import './sidepanel.css';

import { PROFILE_KEYS, filledCount } from '@/storage/schema';
import { loadProfile, onProfileChanged } from '@/storage/profile';
import {
  CLOSED_STAGES,
  STAGE_LABELS,
  listApplications,
  type ApplicationRecord,
} from '@/storage/applications';
import { sendToTab, type FillSummary, type PageDescription } from '@/core/messages';

function must<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) node.append(child);
  return node;
}

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

// ── this-page card ──────────────────────────────────────────────────────────

let currentTabId: number | null = null;
let currentTabUrl: string | null = null;

/**
 * Turns AutoApply on for a site the manifest does not cover.
 *
 * Two steps, both required: Chrome grants the origin only in response to a user
 * gesture, and a permission granted after page load does not retroactively
 * inject the declared content script — so it is injected explicitly.
 */
async function enableOnCurrentSite(): Promise<void> {
  const result = must<HTMLElement>('fill-result');
  if (currentTabId === null || !currentTabUrl) return;

  let origin: string;
  try {
    origin = `${new URL(currentTabUrl).origin}/*`;
  } catch {
    return;
  }

  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) {
    result.className = 'small fill-result warn';
    result.textContent = 'Permission declined — AutoApply stays off for this site.';
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: currentTabId, allFrames: true },
      files: ['content.js'],
    });
  } catch (error) {
    result.className = 'small fill-result error';
    result.textContent = 'Could not start on this page. Reload it and try again.';
    console.error('[AutoApply] injection failed', error);
    return;
  }

  result.className = 'small fill-result muted';
  result.textContent = '';
  await refreshPageCard();
}

/** Chrome's own site-access controls for this extension. */
function openSiteAccessSettings(): void {
  void chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
}

async function refreshPageCard(): Promise<void> {
  const pill = must<HTMLElement>('adapter-pill');
  const target = must<HTMLElement>('page-target');
  const button = must<HTMLButtonElement>('fill-button');
  const enable = must<HTMLButtonElement>('enable-button');
  const grant = must<HTMLButtonElement>('grant-button');

  const tab = await activeTab();
  currentTabId = tab?.id ?? null;
  currentTabUrl = tab?.url ?? null;
  enable.hidden = true;
  grant.hidden = true;

  if (!tab?.id) {
    pill.textContent = 'No page';
    pill.className = 'pill warn';
    target.textContent = 'Open a job application to get started.';
    button.disabled = true;
    return;
  }

  // A tab with no readable URL is not an empty tab. Chrome hides `url` for any
  // site the extension has no host permission for, which is every site outside
  // the six supported boards — exactly where "enable on this site" is meant to
  // help. Clicking the toolbar icon grants activeTab for that tab, which makes
  // the URL readable long enough to ask for the origin properly.
  if (!tab.url) {
    pill.textContent = 'Needs access';
    pill.className = 'pill warn';
    target.textContent =
      'Chrome hides this page’s address until you allow AutoApply on this site. ' +
      'Right-click the AutoApply icon in the toolbar, choose “This can read and change ' +
      'site data”, then pick this site — or use the button below.';
    button.disabled = true;
    grant.hidden = false;
    return;
  }

  if (!/^https?:/.test(tab.url)) {
    pill.textContent = 'No page';
    pill.className = 'pill warn';
    target.textContent = 'Open a job application to get started.';
    button.disabled = true;
    return;
  }

  const description = await sendToTab<PageDescription>(tab.id, { type: 'DESCRIBE_PAGE' });

  if (!description) {
    pill.textContent = 'Not running';
    pill.className = 'pill warn';
    target.textContent =
      'AutoApply runs automatically on Greenhouse, Lever, Ashby, Workable, SmartRecruiters ' +
      'and Workday. On any other site you can turn it on for this domain, and it will use ' +
      'its generic form handling.';
    button.disabled = true;
    // The generic adapter handles any ordinary form — it just needs permission
    // for this origin first, which only the user can grant.
    enable.hidden = false;
    return;
  }

  pill.textContent = description.adapter;
  pill.className = 'pill ok';

  const heading = [description.role, description.company].filter(Boolean).join(' · ');
  const detail = [`${description.fieldCount} fields detected`];
  if (description.step) {
    detail.push(`step ${description.step.current} of ${description.step.total}`);
  }
  target.textContent = heading ? `${heading} — ${detail.join(', ')}` : detail.join(', ');

  button.disabled = description.fieldCount === 0;
}

async function runFill(): Promise<void> {
  const button = must<HTMLButtonElement>('fill-button');
  const result = must<HTMLElement>('fill-result');

  if (currentTabId === null) return;

  button.disabled = true;
  result.className = 'small fill-result muted';
  result.textContent = 'Filling…';

  const summary = await sendToTab<FillSummary>(currentTabId, { type: 'FILL_PAGE' });

  if (!summary) {
    result.className = 'small fill-result error';
    result.textContent = 'The page stopped responding. Reload it and try again.';
    button.disabled = false;
    return;
  }

  const parts = [`Filled ${summary.filled}`, `skipped ${summary.skipped}`];
  if (summary.requiredUnfilled > 0) parts.push(`${summary.requiredUnfilled} required still empty`);
  result.className = `small fill-result ${summary.requiredUnfilled > 0 ? 'warn' : 'ok'}`;
  result.textContent = `${parts.join(' · ')}. Review the page, then submit yourself.`;

  button.disabled = false;
  await refreshHistory();
}

// ── profile card ────────────────────────────────────────────────────────────

async function refreshProfileCard(): Promise<void> {
  const pill = must<HTMLElement>('profile-pill');
  const hint = must<HTMLElement>('profile-hint');

  const profile = await loadProfile();
  const filled = filledCount(profile);
  const total = PROFILE_KEYS.length;

  pill.textContent = `${filled}/${total}`;
  pill.className = `pill ${filled >= 12 ? 'ok' : 'warn'}`;
  hint.textContent =
    filled === 0
      ? 'Your profile is empty — there is nothing to fill with yet. Open Profile to add your details.'
      : filled < 12
        ? 'Add more details to cover the fields most applications ask for.'
        : 'Ready to fill.';
}

// ── history ─────────────────────────────────────────────────────────────────

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function historyItem(record: ApplicationRecord): HTMLElement {
  const item = el('li', { className: 'history-item' });

  const title = record.role || record.company || record.host || 'Application';
  item.append(
    el('a', {
      className: 'history-role',
      href: record.url,
      target: '_blank',
      rel: 'noreferrer',
      textContent: title,
    }),
    el('span', {
      className: `pill ${CLOSED_STAGES.includes(record.stage) ? '' : record.stage === 'draft' ? 'warn' : 'ok'}`,
      textContent: STAGE_LABELS[record.stage],
    }),
  );

  const meta = [record.company, formatDate(record.createdAt), `${record.fieldsFilled} filled`]
    .filter(Boolean)
    .join(' · ');
  item.append(el('span', { className: 'history-meta', textContent: meta }));

  return item;
}

/** The panel is ~320px wide — it shows recent activity; the tracker page manages. */
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
  must<HTMLButtonElement>('open-options').addEventListener('click', () =>
    chrome.runtime.openOptionsPage(),
  );
  must<HTMLButtonElement>('fill-button').addEventListener('click', () => void runFill());
  must<HTMLButtonElement>('enable-button').addEventListener('click', () =>
    void enableOnCurrentSite(),
  );
  must<HTMLButtonElement>('grant-button').addEventListener('click', openSiteAccessSettings);
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
