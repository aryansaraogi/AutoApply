/**
 * Puts a value into a control in a way frameworks actually notice.
 *
 * Assigning `element.value = x` does not work on a React-controlled input: React
 * installs its own setter on the instance and keeps a shadow copy of the value,
 * so the assignment is either swallowed or reverted on the next render. The fix
 * is to call the *prototype's* native setter, rewind React's value tracker, and
 * then dispatch the events the framework is listening for.
 */

import { asTernary, normalizeText } from './normalize';
import type { FieldDescriptor, FieldOption } from './types';

export interface ApplyOutcome {
  ok: boolean;
  reason?: string;
}

const OK: ApplyOutcome = { ok: true };

export async function applyValue(field: FieldDescriptor, value: string): Promise<ApplyOutcome> {
  switch (field.kind) {
    case 'select':
      return applySelect(field, value);
    case 'radiogroup':
      return applyRadioGroup(field, value);
    case 'combobox':
      return applyCombobox(field, value);
    case 'contenteditable':
      return applyContentEditable(field, value);
    case 'checkbox':
      return { ok: false, reason: 'Checkboxes are left for you to tick.' };
    case 'file':
      return { ok: false, reason: 'File uploads must be attached by you.' };
    default:
      return applyTextual(field, value);
  }
}

// ── text-like controls ──────────────────────────────────────────────────────

function applyTextual(field: FieldDescriptor, value: string): ApplyOutcome {
  const element = field.element;
  if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
    return { ok: false, reason: 'Unsupported control.' };
  }

  const coerced = coerceForInput(element, value);
  if (coerced === null) {
    return { ok: false, reason: `"${value}" is not valid for this ${element.type} field.` };
  }

  element.focus({ preventScroll: true });
  setNativeValue(element, coerced);
  dispatch(element, 'input');
  dispatch(element, 'change');
  element.blur();

  return element.value === coerced ? OK : { ok: false, reason: 'The page reset the value.' };
}

/**
 * Assigns through the prototype setter so framework instance setters are
 * bypassed, then rewinds React's value tracker so the change is not deduplicated
 * away. Without the rewind, React compares the tracker to the new value, sees no
 * difference, and never fires onChange.
 */
export function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const previous = element.value;
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;

  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter) setter.call(element, value);
  else element.value = value;

  const tracked = element as unknown as { _valueTracker?: { setValue: (v: string) => void } };
  if (tracked._valueTracker && previous !== value) tracked._valueTracker.setValue(previous);
}

/** Reshapes a profile value to what a typed input will accept, or null if it cannot. */
function coerceForInput(element: HTMLInputElement | HTMLTextAreaElement, value: string): string | null {
  if (!(element instanceof HTMLInputElement)) return value;

  switch (element.type) {
    case 'number': {
      // "$150,000" → "150000"; the input silently rejects anything else.
      const numeric = value.replace(/[^0-9.\-]/g, '');
      return numeric === '' ? null : numeric;
    }
    case 'date': {
      // Date inputs only accept yyyy-mm-dd regardless of display locale.
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return null;
      return parsed.toISOString().slice(0, 10);
    }
    case 'month':
      return /^\d{4}-\d{2}$/.test(value) ? value : null;
    default:
      return value;
  }
}

// ── selects ─────────────────────────────────────────────────────────────────

function applySelect(field: FieldDescriptor, value: string): ApplyOutcome {
  const element = field.element;
  if (!(element instanceof HTMLSelectElement)) return { ok: false, reason: 'Unsupported control.' };

  const option = pickOption(field.options, value);
  if (!option) {
    return { ok: false, reason: `No option matches "${value}".` };
  }

  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  if (setter) setter.call(element, option.value);
  else element.value = option.value;

  dispatch(element, 'input');
  dispatch(element, 'change');

  return element.value === option.value ? OK : { ok: false, reason: 'The page reset the value.' };
}

// ── radio groups ────────────────────────────────────────────────────────────

function applyRadioGroup(field: FieldDescriptor, value: string): ApplyOutcome {
  const option = pickOption(field.options, value);
  if (!option?.element) return { ok: false, reason: `No option matches "${value}".` };

  const radio = option.element;
  if (!(radio instanceof HTMLInputElement)) return { ok: false, reason: 'Unsupported control.' };

  // click() produces the full native sequence (checked flip, input, change,
  // click) which every framework already listens for — more reliable than
  // setting .checked and synthesising events by hand.
  radio.click();

  if (radio.checked) return OK;

  // Some custom widgets intercept the click on a visually-hidden input.
  radio.checked = true;
  dispatch(radio, 'input');
  dispatch(radio, 'change');
  return radio.checked ? OK : { ok: false, reason: 'The page would not select that option.' };
}

// ── comboboxes ──────────────────────────────────────────────────────────────

/**
 * Generic handling only: click an option that is already in the DOM. Library
 * specific widgets (react-select, Workday pickers) need to be opened and typed
 * into first, which is what a site adapter's fillField override is for.
 */
function applyCombobox(field: FieldDescriptor, value: string): ApplyOutcome {
  const option = pickOption(field.options, value);
  if (!option?.element) {
    return { ok: false, reason: 'This dropdown needs to be opened manually.' };
  }
  option.element.click();
  return OK;
}

// ── contenteditable ─────────────────────────────────────────────────────────

function applyContentEditable(field: FieldDescriptor, value: string): ApplyOutcome {
  const element = field.element;
  element.focus({ preventScroll: true });

  // execCommand is deprecated but remains the only way to produce a real
  // InputEvent that rich-text editors treat as user typing.
  const selection = element.ownerDocument.getSelection();
  if (selection) {
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  const inserted = element.ownerDocument.execCommand?.('insertText', false, value) ?? false;
  if (!inserted) {
    element.textContent = value;
    dispatch(element, 'input');
  }
  element.blur();

  return (element.textContent ?? '').includes(value)
    ? OK
    : { ok: false, reason: 'The editor rejected the text.' };
}

// ── option matching ─────────────────────────────────────────────────────────

/**
 * Finds the option that means `value`.
 *
 * Every fuzzy tier requires a *unique* candidate. "United States" must not
 * silently select "United States Minor Outlying Islands" just because it is the
 * first prefix hit.
 */
export function pickOption(options: readonly FieldOption[], value: string): FieldOption | null {
  const wanted = normalizeText(value);
  if (!wanted) return null;

  // Placeholder entries ("Select…") carry a blank value and are never an answer.
  const real = options.filter((option) => option.value !== '' || normalizeText(option.label) !== '');

  const exact = real.filter(
    (option) => normalizeText(option.label) === wanted || normalizeText(option.value) === wanted,
  );
  if (exact.length > 0) return exact[0] as FieldOption;

  const wantedTernary = asTernary(value);
  if (wantedTernary) {
    const ternary = real.filter(
      (option) =>
        asTernary(option.label) === wantedTernary || asTernary(option.value) === wantedTernary,
    );
    if (ternary.length === 1) return ternary[0] as FieldOption;
  }

  const prefix = real.filter((option) => {
    const label = normalizeText(option.label);
    return label !== '' && (label.startsWith(wanted) || wanted.startsWith(label));
  });
  if (prefix.length === 1) return prefix[0] as FieldOption;

  const contains = real.filter((option) => {
    const label = normalizeText(option.label);
    return label !== '' && (label.includes(wanted) || wanted.includes(label));
  });
  if (contains.length === 1) return contains[0] as FieldOption;

  return null;
}

// ── events ──────────────────────────────────────────────────────────────────

function dispatch(element: HTMLElement, type: 'input' | 'change'): void {
  const event =
    type === 'input'
      ? new InputEvent('input', { bubbles: true, composed: true })
      : new Event('change', { bubbles: true });
  element.dispatchEvent(event);
}
