import type { ProfileKey } from '@/storage/schema';

/**
 * How we interact with a control. This is deliberately coarser than the DOM's
 * own type zoo — the fill engine only cares about the interaction pattern, not
 * whether an input is `type=text` or `type=search`.
 */
export type ControlKind =
  | 'text'
  | 'email'
  | 'tel'
  | 'url'
  | 'number'
  | 'date'
  | 'textarea'
  | 'select'
  | 'radiogroup'
  | 'checkbox'
  | 'combobox'
  | 'contenteditable'
  | 'file';

/** Kinds we can type free text into. */
export const TEXTUAL_KINDS: readonly ControlKind[] = [
  'text',
  'email',
  'tel',
  'url',
  'number',
  'date',
  'textarea',
  'contenteditable',
];

/** Kinds where the answer must come from a fixed list. */
export const CHOICE_KINDS: readonly ControlKind[] = ['select', 'radiogroup', 'combobox'];

export interface FieldOption {
  /** The value to assign (option.value, radio input value). */
  value: string;
  /** What the user sees. */
  label: string;
  /** Present for radio inputs and listbox options — the thing to click. */
  element?: HTMLElement;
}

/** Where a field's label came from. Useful when debugging a bad match. */
export type LabelSource =
  | 'aria-labelledby'
  | 'label-for'
  | 'label-ancestor'
  | 'aria-label'
  | 'legend'
  | 'preceding-text'
  | 'placeholder'
  | 'name-attribute'
  | 'none';

export interface FieldDescriptor {
  /** Stable within a single harvest pass; used to correlate reports to fields. */
  id: string;
  element: HTMLElement;
  kind: ControlKind;

  name: string;
  domId: string;
  autocomplete: string;
  placeholder: string;
  ariaLabel: string;

  /** Human-readable label as found in the page. */
  label: string;
  /** Lowercased, de-punctuated form used for matching. */
  normalizedLabel: string;
  labelSource: LabelSource;
  /** Enclosing fieldset legend or group label — often the real question for radios. */
  legend: string;

  required: boolean;
  options: FieldOption[];
  /** True when the control already holds a value we would otherwise overwrite. */
  hasValue: boolean;
  /** Which document the field lives in — differs for same-origin iframes. */
  frameUrl: string;
}

/**
 * Profile keys plus values we compose on the fly. Forms routinely ask for a
 * single "Full name" field that no single profile key answers.
 */
export type ValueKey = ProfileKey | 'fullName';

export interface MatchResult {
  key: ValueKey;
  score: number;
  /** Which signal won: helps explain a surprising match in the overlay. */
  via: 'autocomplete' | 'label' | 'attribute';
}

export type FieldStatus =
  | 'filled'
  /** Matched a profile key, but that key is empty in the profile. */
  | 'no-value'
  /** No rule matched with enough confidence. */
  | 'unmatched'
  /** Two rules matched about equally well — we refuse to guess. */
  | 'ambiguous'
  /** The control already had a value and overwrite was off. */
  | 'preserved'
  /** A control kind this version does not touch (file uploads, consent boxes). */
  | 'unsupported'
  /** We tried and the control did not take the value. */
  | 'failed';

export interface FieldReport {
  fieldId: string;
  label: string;
  kind: ControlKind;
  required: boolean;
  status: FieldStatus;
  key?: ValueKey;
  value?: string;
  reason?: string;
  /** Where a filled value came from. */
  source?: 'rules' | 'resume';
}

export interface FillOptions {
  /** Replace values already present in the form. Off by default so a second
   *  pass never destroys something the user typed by hand. */
  overwrite: boolean;
}

export const DEFAULT_FILL_OPTIONS: FillOptions = { overwrite: false };
