/**
 * The review layer.
 *
 * After a fill pass this outlines what changed and lists everything still
 * needing a human, so the user can check the form at a glance instead of
 * re-reading every field. It lives in its own shadow root so page CSS cannot
 * restyle it and page scripts do not trip over it.
 *
 * There is deliberately no submit control anywhere in here.
 */

import type { FieldDescriptor, FieldReport, FieldStatus } from '@/core/types';

export interface OverlayInput {
  reports: readonly FieldReport[];
  fields: ReadonlyMap<string, FieldDescriptor>;
  filled: number;
  skipped: number;
  requiredUnfilled: number;
  /** Outline the affected controls in the page itself. */
  highlight: boolean;
  /** Nothing was filled because there is nothing stored to fill with. */
  profileIsEmpty?: boolean;
}

const HOST_ID = 'autoapply-review-root';
const OUTLINE_FLAG = 'data-autoapply-outlined';
const MAX_LISTED = 12;

/** Statuses that mean "we put something here". */
const SUCCESS: readonly FieldStatus[] = ['filled'];

/** Statuses worth listing for the user, most urgent first. */
const ATTENTION_ORDER: readonly FieldStatus[] = [
  'failed',
  'ambiguous',
  'no-value',
  'unsupported',
  'unmatched',
];

let cleanup: (() => void) | null = null;

export function showOverlay(input: OverlayInput): void {
  clearOverlay();

  const host = document.createElement('div');
  host.id = HOST_ID;
  // The host itself must not participate in page layout.
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.append(styleElement(), panelElement(input));
  document.documentElement.append(host);

  const undoOutlines = input.highlight ? outlineFields(input) : () => {};

  cleanup = () => {
    undoOutlines();
    host.remove();
  };
}

export function clearOverlay(): void {
  cleanup?.();
  cleanup = null;
  document.getElementById(HOST_ID)?.remove();
}

// ── in-page outlines ────────────────────────────────────────────────────────

/**
 * Outlines are applied as inline styles rather than injected CSS classes: it
 * avoids fighting the page's own stylesheet specificity, and undoing it is a
 * matter of restoring the one property we touched.
 */
function outlineFields(input: OverlayInput): () => void {
  const touched: { element: HTMLElement; outline: string; offset: string }[] = [];

  for (const report of input.reports) {
    const colour = outlineColour(report);
    if (!colour) continue;

    const element = input.fields.get(report.fieldId)?.element;
    if (!element) continue;

    touched.push({
      element,
      outline: element.style.outline,
      offset: element.style.outlineOffset,
    });
    element.style.outline = `2px solid ${colour}`;
    element.style.outlineOffset = '2px';
    element.setAttribute(OUTLINE_FLAG, report.status);
  }

  return () => {
    for (const { element, outline, offset } of touched) {
      element.style.outline = outline;
      element.style.outlineOffset = offset;
      element.removeAttribute(OUTLINE_FLAG);
    }
  };
}

function outlineColour(report: FieldReport): string | null {
  // These are the one place the extension draws on someone else's page, so they
  // are picked to stay legible against both light and dark form backgrounds.
  if (SUCCESS.includes(report.status)) return '#16a34a';
  if (report.status === 'failed' || report.status === 'ambiguous') return '#ea580c';
  if (report.required) return '#d97706';
  return null;
}

// ── panel ───────────────────────────────────────────────────────────────────

function panelElement(input: OverlayInput): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-label', 'AutoApply fill summary');

  panel.append(headerElement(input));

  if (input.profileIsEmpty) {
    const empty = document.createElement('p');
    empty.className = 'empty-profile';
    empty.textContent =
      'Your profile is empty, so there was nothing to fill this form with. Open ' +
      'AutoApply and add your details, then try again.';
    panel.append(empty);
  }

  const attention = rankAttention(input.reports);
  if (attention.length > 0) {
    panel.append(listElement(attention, input));
  } else {
    const done = document.createElement('p');
    done.className = 'all-clear';
    done.textContent = 'Everything AutoApply could answer is filled in.';
    panel.append(done);
  }

  const footer = document.createElement('p');
  footer.className = 'footer';
  footer.textContent = 'Nothing has been submitted. Review the form, then submit it yourself.';
  panel.append(footer);

  return panel;
}

function headerElement(input: OverlayInput): HTMLElement {
  const header = document.createElement('header');

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = 'AutoApply';

  const counts = document.createElement('div');
  counts.className = 'counts';
  counts.append(
    chip(`${input.filled} filled`, 'ok'),
    chip(`${input.skipped} skipped`, 'muted'),
  );
  if (input.requiredUnfilled > 0) {
    counts.append(chip(`${input.requiredUnfilled} required left`, 'warn'));
  }

  const close = document.createElement('button');
  close.className = 'close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss AutoApply summary');
  close.textContent = '×';
  close.addEventListener('click', () => clearOverlay());

  header.append(title, close, counts);
  return header;
}

function chip(text: string, tone: 'ok' | 'warn' | 'muted'): HTMLElement {
  const node = document.createElement('span');
  node.className = `chip ${tone}`;
  node.textContent = text;
  return node;
}

function listElement(reports: FieldReport[], input: OverlayInput): HTMLElement {
  const wrapper = document.createElement('div');

  const heading = document.createElement('h2');
  heading.textContent = 'Needs you';
  wrapper.append(heading);

  const list = document.createElement('ul');
  for (const report of reports.slice(0, MAX_LISTED)) {
    list.append(itemElement(report, input));
  }
  wrapper.append(list);

  if (reports.length > MAX_LISTED) {
    const more = document.createElement('p');
    more.className = 'more';
    more.textContent = `…and ${reports.length - MAX_LISTED} more.`;
    wrapper.append(more);
  }

  return wrapper;
}

function itemElement(report: FieldReport, input: OverlayInput): HTMLElement {
  const item = document.createElement('li');

  const button = document.createElement('button');
  button.type = 'button';
  button.className = report.required ? 'item required' : 'item';

  const label = document.createElement('span');
  label.className = 'item-label';
  label.textContent = report.label || '(unlabelled field)';

  const reason = document.createElement('span');
  reason.className = 'item-reason';
  reason.textContent = report.reason ?? report.status;

  button.append(label, reason);
  button.addEventListener('click', () => revealField(input.fields.get(report.fieldId)));

  item.append(button);
  return item;
}

function revealField(field: FieldDescriptor | undefined): void {
  if (!field) return;
  field.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // Radio groups resolve to a container, which is not itself focusable.
  const focusTarget =
    field.element.matches('input, select, textarea, [contenteditable="true"]')
      ? field.element
      : field.element.querySelector<HTMLElement>('input, select, textarea');
  focusTarget?.focus({ preventScroll: true });
}

/** Required problems first, then by how likely the user is to care. */
function rankAttention(reports: readonly FieldReport[]): FieldReport[] {
  return reports
    .filter((report) => ATTENTION_ORDER.includes(report.status))
    // An unmatched optional field is usually a question we simply do not store;
    // listing every one of them would bury the things that block submission.
    .filter((report) => report.required || report.status !== 'unmatched')
    .sort((a, b) => {
      if (a.required !== b.required) return a.required ? -1 : 1;
      return ATTENTION_ORDER.indexOf(a.status) - ATTENTION_ORDER.indexOf(b.status);
    });
}

// ── styles ──────────────────────────────────────────────────────────────────

/**
 * The overlay lives in a shadow root, so it cannot inherit the extension pages'
 * CSS variables — it carries its own copy of the palette. Kept deliberately in
 * step with ui/shared.css; if the accent changes there, change it here too.
 */
function styleElement(): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; }

    .panel {
      --surface: #ffffff;
      --ink: #14161d;
      --ink-muted: #5b6373;
      --line: rgb(18 22 32 / 10%);
      --hover: rgb(18 22 32 / 5%);

      position: fixed;
      right: 16px;
      bottom: 16px;
      width: 344px;
      max-height: min(70vh, 560px);
      overflow-y: auto;
      padding: 15px 16px;
      border-radius: 12px;
      border: 1px solid var(--line);
      background: var(--surface);
      color: var(--ink);
      box-shadow: 0 2px 4px rgb(18 22 32 / 8%), 0 16px 40px -8px rgb(18 22 32 / 26%);
      font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
    }

    @media (prefers-color-scheme: dark) {
      .panel {
        --surface: #1c2029;
        --ink: #e9ebf0;
        --ink-muted: #98a1b2;
        --line: rgb(255 255 255 / 12%);
        --hover: rgb(255 255 255 / 7%);
        box-shadow: 0 2px 4px rgb(0 0 0 / 50%), 0 16px 40px -8px rgb(0 0 0 / 60%);
      }
    }

    header {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 6px;
      align-items: center;
    }

    .title { font-weight: 680; letter-spacing: -0.015em; font-size: 14px; }

    .close {
      justify-self: end;
      width: 26px;
      height: 26px;
      border: none;
      border-radius: 7px;
      background: transparent;
      color: var(--ink-muted);
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
      transition: background 120ms ease, color 120ms ease;
    }
    .close:hover { color: var(--ink); background: var(--hover); }

    .counts {
      grid-column: 1 / -1;
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-top: 8px;
    }

    .chip {
      padding: 3px 9px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 640;
      letter-spacing: 0.01em;
    }
    .chip.ok { background: #e6f5ec; color: #16794a; }
    .chip.warn { background: #fdf2df; color: #8a5a00; }
    .chip.muted { background: var(--hover); color: var(--ink-muted); }

    @media (prefers-color-scheme: dark) {
      .chip.ok { background: #102b1e; color: #4ecf94; }
      .chip.warn { background: #2e2311; color: #e0ad63; }
    }

    h2 {
      margin: 15px 0 7px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--ink-muted);
    }

    ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }

    .item {
      display: block;
      width: 100%;
      padding: 8px 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease;
    }
    .item:hover { background: var(--hover); border-color: var(--ink-muted); }
    .item.required { border-left: 3px solid #d97706; }

    .item-label { display: block; font-weight: 600; }
    .item-reason { display: block; margin-top: 2px; font-size: 12px; color: var(--ink-muted); }

    .all-clear { margin: 13px 0 0; color: var(--ink-muted); }
    .more { margin: 7px 0 0; font-size: 12px; color: var(--ink-muted); }

    .footer {
      margin: 13px 0 0;
      padding-top: 11px;
      border-top: 1px solid var(--line);
      font-size: 12px;
      color: var(--ink-muted);
    }
  `;
  return style;
}
