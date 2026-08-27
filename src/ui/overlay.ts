/**
 * The review layer.
 *
 * After a fill pass this outlines what changed and lists everything still
 * needing a human, so the user can check the form at a glance instead of
 * re-reading every field. It lives in its own shadow root so page CSS cannot
 * restyle it and page scripts do not trip over it.
 *
 * It also has to stay out of the way of the thing it is describing. A fixed
 * panel in the corner of a centred application form covers the right-hand edge
 * of that form, so it can be collapsed to a single counts bar or moved to the
 * other side. Collapsing is the reversible option and the one Escape reaches;
 * the close button still removes it outright, because this is the user's own
 * page and clearing something off it should never be a one-way door.
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

/** Shown before the list is expanded. Enough to see the shape of the problem. */
const INITIAL_LISTED = 8;

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
  // A region rather than a live region: this contains a scrolling list of
  // buttons, and role="status" made assistive tech announce the whole thing on
  // insertion. The one-line summary below is the part worth announcing.
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'AutoApply fill summary');

  const attention = rankAttention(input.reports);

  panel.append(announcement(input, attention.length), headerElement(input, panel));

  const body = document.createElement('div');
  body.className = 'body';

  if (input.profileIsEmpty) {
    const empty = document.createElement('p');
    empty.className = 'empty-profile';
    empty.textContent =
      'Your profile is empty, so there was nothing to fill this form with. Open ' +
      'AutoApply and add your details, then try again.';
    body.append(empty);
  }

  if (attention.length > 0) {
    body.append(listElement(attention, input));
  } else {
    const done = document.createElement('p');
    done.className = 'all-clear';
    done.textContent = 'Everything AutoApply could answer is filled in.';
    body.append(done);
  }

  const footer = document.createElement('p');
  footer.className = 'footer';
  footer.textContent = 'Nothing has been submitted. Review the form, then submit it yourself.';
  body.append(footer);

  panel.append(body);

  // Escape is scoped to the panel rather than the document: this is someone
  // else's page, and a form there may well use Escape for its own purposes.
  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    collapse(panel, true);
  });

  return panel;
}

/** The single sentence worth reading aloud when the panel appears. */
function announcement(input: OverlayInput, attention: number): HTMLElement {
  const live = document.createElement('p');
  live.className = 'sr-only';
  live.setAttribute('role', 'status');
  live.textContent =
    `AutoApply filled ${input.filled} field${input.filled === 1 ? '' : 's'}, ` +
    `skipped ${input.skipped}. ${attention} need${attention === 1 ? 's' : ''} your attention. ` +
    'Nothing has been submitted.';
  return live;
}

function headerElement(input: OverlayInput, panel: HTMLElement): HTMLElement {
  const header = document.createElement('header');

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = 'AutoApply';

  const tools = document.createElement('div');
  tools.className = 'tools';

  // Moves the panel to the other side, for a form whose fields sit under it.
  const side = iconButton('side', '⇄', 'Move panel to the other side');
  side.addEventListener('click', () => panel.classList.toggle('left'));

  // Collapsing leaves the counts bar behind, so the review can be brought back;
  // closing removes the overlay outright, which stays available because this is
  // the user's page and they are entitled to clear it off.
  const toggle = iconButton('toggle', '–', 'Collapse AutoApply summary');
  toggle.addEventListener('click', () => collapse(panel, !panel.classList.contains('collapsed')));

  const close = iconButton('close', '×', 'Dismiss AutoApply summary');
  close.addEventListener('click', () => clearOverlay());

  tools.append(side, toggle, close);

  const counts = document.createElement('div');
  counts.className = 'counts';
  counts.append(chip(`${input.filled} filled`, 'ok'), chip(`${input.skipped} skipped`, 'muted'));
  if (input.requiredUnfilled > 0) {
    counts.append(chip(`${input.requiredUnfilled} required left`, 'warn'));
  }

  header.append(title, tools, counts);

  // Collapsed, the header itself becomes the way back — the whole bar is the
  // target rather than one small button.
  header.addEventListener('click', (event) => {
    if (!panel.classList.contains('collapsed')) return;
    if (event.target instanceof Element && event.target.closest('.tool')) return;
    collapse(panel, false);
  });

  return header;
}

function collapse(panel: HTMLElement, collapsed: boolean): void {
  panel.classList.toggle('collapsed', collapsed);
  const toggle = panel.querySelector('.tool-toggle');
  if (!toggle) return;
  toggle.textContent = collapsed ? '+' : '–';
  toggle.setAttribute(
    'aria-label',
    collapsed ? 'Expand AutoApply summary' : 'Collapse AutoApply summary',
  );
}

function iconButton(kind: 'side' | 'toggle' | 'close', glyph: string, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `tool tool-${kind}`;
  button.textContent = glyph;
  button.setAttribute('aria-label', label);
  button.title = label;
  return button;
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
  heading.textContent = `Needs you · ${reports.length}`;
  wrapper.append(heading);

  const list = document.createElement('ul');
  for (const report of reports.slice(0, INITIAL_LISTED)) {
    list.append(itemElement(report, input));
  }
  wrapper.append(list);

  // The rest used to be a dead "…and 6 more." line. It is a button now, because
  // the fields it was hiding are exactly the ones blocking a submit.
  if (reports.length > INITIAL_LISTED) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'more';
    more.textContent = `Show ${reports.length - INITIAL_LISTED} more`;
    more.addEventListener('click', () => {
      for (const report of reports.slice(INITIAL_LISTED)) {
        list.append(itemElement(report, input));
      }
      more.remove();
    });
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
  if (report.required) {
    const flag = document.createElement('span');
    flag.className = 'item-required';
    flag.textContent = 'required';
    label.append(flag);
  }

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
  const focusTarget = field.element.matches('input, select, textarea, [contenteditable="true"]')
    ? field.element
    : field.element.querySelector<HTMLElement>('input, select, textarea');
  focusTarget?.focus({ preventScroll: true });
}

/** Required problems first, then by how likely the user is to care. */
function rankAttention(reports: readonly FieldReport[]): FieldReport[] {
  return (
    reports
      .filter((report) => ATTENTION_ORDER.includes(report.status))
      // An unmatched optional field is usually a question we simply do not store;
      // listing every one of them would bury the things that block submission.
      .filter((report) => report.required || report.status !== 'unmatched')
      .sort((a, b) => {
        if (a.required !== b.required) return a.required ? -1 : 1;
        return ATTENTION_ORDER.indexOf(a.status) - ATTENTION_ORDER.indexOf(b.status);
      })
  );
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

    .sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0;
      overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
    }

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
      max-width: calc(100vw - 32px);
      max-height: min(70vh, 560px);
      display: flex;
      flex-direction: column;
      border-radius: 12px;
      border: 1px solid var(--line);
      background: var(--surface);
      color: var(--ink);
      box-shadow: 0 2px 4px rgb(18 22 32 / 8%), 0 16px 40px -8px rgb(18 22 32 / 26%);
      font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
      transition: max-height 160ms ease;
    }

    /* Plenty of ATS layouts push their content to one side, or park a job
       description in a right-hand column. Moving the panel across clears it.
       A form centred in a wide window overlaps both sides about equally, and
       collapsing is the answer there instead. */
    .panel.left { right: auto; left: 16px; }

    @media (prefers-reduced-motion: reduce) {
      .panel { transition: none; }
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

    /* The header stays put while the list scrolls, so the counts and the
       collapse control never scroll out of reach. */
    header {
      flex: none;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 6px;
      align-items: center;
      padding: 13px 14px 11px;
      border-bottom: 1px solid var(--line);
      border-radius: 12px 12px 0 0;
      background: var(--surface);
    }

    .body {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 0 14px 14px;
      overscroll-behavior: contain;
    }

    .title { font-weight: 680; letter-spacing: -0.015em; font-size: 14px; }

    .tools { display: flex; gap: 2px; justify-self: end; }

    .tool {
      width: 26px;
      height: 26px;
      border: none;
      border-radius: 7px;
      background: transparent;
      color: var(--ink-muted);
      font: inherit;
      font-size: 15px;
      line-height: 1;
      cursor: pointer;
      transition: background 120ms ease, color 120ms ease;
    }
    .tool:hover { color: var(--ink); background: var(--hover); }
    .tool:focus-visible { outline: 2px solid #4f46e5; outline-offset: 1px; }

    .counts {
      grid-column: 1 / -1;
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-top: 8px;
    }

    /* Collapsed: the counts bar alone, which is the summary anyone glancing at it
       actually wants, and clicking it brings the list back. */
    .panel.collapsed { max-height: none; }
    .panel.collapsed .body { display: none; }
    .panel.collapsed header {
      border-bottom: none;
      border-radius: 12px;
      cursor: pointer;
      padding-bottom: 12px;
    }
    .panel.collapsed header:hover { background: var(--hover); }
    .panel.collapsed .tool-side { display: none; }
    .tool-close { font-size: 18px; }

    .chip {
      padding: 3px 9px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 640;
      letter-spacing: 0.01em;
      white-space: nowrap;
    }
    .chip.ok { background: #e6f5ec; color: #16794a; }
    .chip.warn { background: #fdf2df; color: #8a5a00; }
    .chip.muted { background: var(--hover); color: var(--ink-muted); }

    @media (prefers-color-scheme: dark) {
      .chip.ok { background: #102b1e; color: #4ecf94; }
      .chip.warn { background: #2e2311; color: #e0ad63; }
    }

    h2 {
      margin: 14px 0 7px;
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
    .item:focus-visible { outline: 2px solid #4f46e5; outline-offset: 1px; }
    .item.required { border-left: 3px solid #d97706; }

    .item-label {
      display: flex;
      align-items: baseline;
      gap: 7px;
      font-weight: 600;
    }

    /* Says why the left border is there, rather than leaving it to be inferred. */
    .item-required {
      flex: none;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #b45309;
    }

    @media (prefers-color-scheme: dark) {
      .item-required { color: #e0ad63; }
    }

    .item-reason { display: block; margin-top: 2px; font-size: 12px; color: var(--ink-muted); }

    .all-clear { margin: 13px 0 0; color: var(--ink-muted); }
    .empty-profile { margin: 13px 0 0; }

    .more {
      display: block;
      width: 100%;
      margin: 7px 0 0;
      padding: 7px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: transparent;
      color: var(--ink-muted);
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 120ms ease, color 120ms ease;
    }
    .more:hover { background: var(--hover); color: var(--ink); }
    .more:focus-visible { outline: 2px solid #4f46e5; outline-offset: 1px; }

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
