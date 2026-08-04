/**
 * Text normalization shared by label resolution and option matching.
 *
 * Every comparison in the match engine runs on normalized text, so the rules in
 * rules.ts can be written against clean lowercase words instead of defending
 * against non-breaking spaces, smart quotes, and "(Required)" suffixes.
 */

/** Markers ATS forms append to a label to indicate a required field. */
const REQUIRED_MARKERS = /\s*(\*+|\(\s*required\s*\)|\brequired\b|\(\s*optional\s*\))\s*$/gi;

/** Combining diacritical marks, left behind by NFKD decomposition. */
const COMBINING_MARKS = /[̀-ͯ]/g;

/** Curly and straight apostrophes, removed rather than spaced so "don't" stays one word. */
const APOSTROPHES = /[‘’']/g;

/**
 * Lowercases, strips diacritics, and reduces every run of punctuation or
 * whitespace to a single space, so "E‑mail Address:*" and "email address"
 * compare equal after canonicalize() folds the hyphenation.
 */
export function normalizeText(input: string): string {
  return input
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(APOSTROPHES, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Strips trailing required/optional markers before normalizing. */
export function normalizeLabel(input: string): string {
  return normalizeText(input.replace(REQUIRED_MARKERS, ''));
}

/**
 * Folds the handful of spellings that forms vary on, so a single rule pattern
 * covers every variant. "E-mail" → "email", "Surname" → "last name".
 */
export function canonicalize(input: string): string {
  return normalizeLabel(input)
    .replace(/\be mail\b/g, 'email')
    .replace(/\blinked in\b/g, 'linkedin')
    .replace(/\bgit hub\b/g, 'github')
    .replace(/\bzip code\b/g, 'zip')
    .replace(/\bpostal code\b/g, 'postcode')
    .replace(/\bmobile\b/g, 'phone')
    .replace(/\bcell\b/g, 'phone')
    .replace(/\btelephone\b/g, 'phone')
    .replace(/\bsurname\b/g, 'last name')
    .replace(/\bfamily name\b/g, 'last name')
    .replace(/\bgiven names?\b/g, 'first name')
    .replace(/\bforename\b/g, 'first name')
    .replace(/\bcurriculum vitae\b/g, 'resume');
}

/**
 * Splits an attribute value into words. Handles the conventions that show up in
 * `name` and `id`: snake_case, kebab-case, camelCase, and the bracketed paths
 * Rails-style forms produce ("job_application[candidate][first_name]").
 */
export function normalizeAttribute(input: string): string {
  return canonicalize(input.replace(/([a-z0-9])([A-Z])/g, '$1 $2'));
}

/** True when the text carries no useful content. */
export function isBlank(input: string | null | undefined): boolean {
  return !input || normalizeText(input) === '';
}

/**
 * Visible text of an element, excluding anything inside a nested form control.
 *
 * Without this, `<label>Country <select><option>United States</option></select></label>`
 * resolves to the label "Country United States", which then fails to match the
 * `country` rule and may match something else entirely.
 */
export function visibleTextOf(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  for (const node of clone.querySelectorAll(
    'input, select, textarea, button, option, script, style, svg',
  )) {
    node.remove();
  }
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Yes/no synonyms, so a "Yes" profile answer can select a "Y" or "True" option. */
const AFFIRMATIVE = new Set(['yes', 'y', 'true', '1', 'yes i am', 'i am', 'affirmative']);
const NEGATIVE = new Set(['no', 'n', 'false', '0', 'no i am not', 'i am not', 'negative']);

export type Ternary = 'yes' | 'no' | null;

export function asTernary(input: string): Ternary {
  const text = normalizeText(input);
  if (AFFIRMATIVE.has(text)) return 'yes';
  if (NEGATIVE.has(text)) return 'no';
  return null;
}
