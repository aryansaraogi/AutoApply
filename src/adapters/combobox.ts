/**
 * Drives the custom dropdown widgets that modern ATS forms use instead of a
 * <select>: react-select, Downshift, Radix, and every in-house variant of them.
 *
 * They differ in markup but not in behaviour, so one driver covers all of them:
 *
 *   focus and open  →  type to filter  →  wait for the listbox  →  press the option
 *
 * Two details make or break it. The listbox is usually portalled to <body>, so
 * options must be searched for document-wide rather than inside the field. And
 * these libraries commit a selection on *mousedown*, not click — dispatching
 * only a click event opens the menu and then quietly does nothing.
 */

import { pickOption, setNativeValue } from '@/core/setValue';
import { visibleTextOf } from '@/core/normalize';
import type { ApplyOutcome } from '@/core/setValue';
import type { FieldDescriptor, FieldOption } from '@/core/types';
import type { FillOverride } from '@/core/fill';

const OPTION_SELECTOR = '[role="option"]';
const DEFAULT_TIMEOUT_MS = 1500;
const POLL_INTERVAL_MS = 40;

export interface ComboboxConfig {
  /** How long to wait for options to appear after typing. */
  timeoutMs?: number;
  /** Extra selector for the text input inside a composite widget. */
  inputSelector?: string;
  /** Overrides how menu items are found, for widgets that skip role="option". */
  optionSelector?: string;
}

/** A FillOverride that handles combobox fields and passes everything else through. */
export function comboboxFiller(config: ComboboxConfig = {}): FillOverride {
  return async (field, value) => {
    if (field.kind !== 'combobox') return null;
    return driveCombobox(field, value, config);
  };
}

export async function driveCombobox(
  field: FieldDescriptor,
  value: string,
  config: ComboboxConfig = {},
): Promise<ApplyOutcome> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const container = field.element;
  const input = findTextInput(container, config.inputSelector);

  open(container, input);

  // Typing narrows long lists (country pickers run to 200+ entries) and is what
  // async-loading widgets need in order to fetch anything at all.
  if (input) {
    setNativeValue(input, value);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
  }

  const option = await waitForOption(
    container,
    value,
    timeoutMs,
    config.optionSelector ?? OPTION_SELECTOR,
  );
  if (!option) {
    close(container, input);
    return { ok: false, reason: `No option matching "${value}" appeared. Pick it yourself.` };
  }

  press(option);
  await tick();

  return confirmSelection(container, input, value);
}

// ── steps ───────────────────────────────────────────────────────────────────

function findTextInput(container: HTMLElement, extra?: string): HTMLInputElement | null {
  if (container instanceof HTMLInputElement) return container;
  const selector = extra ? `input, ${extra}` : 'input';
  const found = container.querySelector<HTMLElement>(selector);
  return found instanceof HTMLInputElement ? found : null;
}

function open(container: HTMLElement, input: HTMLInputElement | null): void {
  const target = input ?? container;
  target.focus({ preventScroll: true });
  if (container.getAttribute('aria-expanded') === 'true') return;
  // Some widgets open on mousedown, others on click — send both.
  fire(target, ['pointerdown', 'mousedown', 'mouseup', 'click']);
}

function close(container: HTMLElement, input: HTMLInputElement | null): void {
  const target = input ?? container;
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
  );
  target.blur();
}

/**
 * Presses an option the way these libraries expect. react-select and Downshift
 * both select on mousedown; sending click alone is the single most common reason
 * a "working" autofill silently leaves a dropdown empty.
 */
function press(option: HTMLElement): void {
  option.scrollIntoView?.({ block: 'nearest' });
  fire(option, ['pointerover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
}

async function waitForOption(
  container: HTMLElement,
  value: string,
  timeoutMs: number,
  optionSelector: string,
): Promise<HTMLElement | null> {
  const deadline = Date.now() + timeoutMs;

  do {
    const match = pickOption(liveOptions(container, optionSelector), value);
    if (match?.element) return match.element;
    await delay(POLL_INTERVAL_MS);
  } while (Date.now() < deadline);

  return null;
}

/**
 * Collects the currently rendered options.
 *
 * Searched document-wide because these menus are routinely portalled out of the
 * field's subtree, but scoped to the widget's own listbox first when it declares
 * one — that avoids grabbing options from a different open dropdown.
 */
function liveOptions(container: HTMLElement, optionSelector: string): FieldOption[] {
  const owned = container.getAttribute('aria-controls') ?? container.getAttribute('aria-owns');
  const listbox = owned ? document.getElementById(owned) : null;
  const scope: ParentNode = listbox ?? container.ownerDocument;

  return [...scope.querySelectorAll<HTMLElement>(optionSelector)]
    .filter(isRendered)
    .map((element) => ({
      value: element.getAttribute('data-value') ?? visibleTextOf(element),
      label: visibleTextOf(element),
      element,
    }));
}

function isRendered(element: HTMLElement): boolean {
  if (element.getAttribute('aria-disabled') === 'true') return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return !style || (style.display !== 'none' && style.visibility !== 'hidden');
}

/**
 * Confirms the widget actually took the value. These components can accept a
 * press and still revert, so reporting success without checking would put a
 * green outline on an empty field.
 */
function confirmSelection(
  container: HTMLElement,
  input: HTMLInputElement | null,
  value: string,
): ApplyOutcome {
  const shown = `${input?.value ?? ''} ${visibleTextOf(container)}`.toLowerCase();
  if (shown.includes(value.toLowerCase())) return { ok: true };

  // The displayed text is often an abbreviation of the option label, so a
  // selected-descendant marker is the more reliable second signal.
  if (container.querySelector('[aria-selected="true"], [data-selected="true"]')) {
    return { ok: true };
  }
  return { ok: false, reason: 'The dropdown did not keep the selection — set it yourself.' };
}

// ── plumbing ────────────────────────────────────────────────────────────────

function fire(element: HTMLElement, types: readonly string[]): void {
  for (const type of types) {
    const event =
      type.startsWith('pointer') && typeof PointerEvent === 'function'
        ? new PointerEvent(type, { bubbles: true, composed: true })
        : new MouseEvent(type, { bubbles: true, composed: true, button: 0 });
    element.dispatchEvent(event);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tick(): Promise<void> {
  return delay(0);
}
