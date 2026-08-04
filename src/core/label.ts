/**
 * Works out what a form control is called.
 *
 * This is the single highest-leverage piece of the engine: if the label is
 * wrong, every downstream rule is matching against the wrong string. The chain
 * below is ordered by how much the page author explicitly told us — an
 * `aria-labelledby` is a statement of intent, a nearby text node is a guess.
 */

import { isBlank, visibleTextOf } from './normalize';
import type { LabelSource } from './types';

export interface ResolvedLabel {
  text: string;
  source: LabelSource;
}

/** How far up the tree the "nearby text" heuristic will climb. */
const MAX_CLIMB = 4;

/** Longer than this and it is prose, not a label. */
const MAX_LABEL_LENGTH = 200;

const EMPTY: ResolvedLabel = { text: '', source: 'none' };

type Root = Document | ShadowRoot;

export function resolveLabel(element: HTMLElement, root: Root): ResolvedLabel {
  for (const attempt of [
    fromAriaLabelledBy,
    fromLabelFor,
    fromAncestorLabel,
    fromAriaLabel,
    fromOwnLegend,
    fromPrecedingText,
    fromPlaceholder,
    fromNameAttribute,
  ]) {
    const result = attempt(element, root);
    if (result && !isBlank(result.text)) {
      return { text: result.text.slice(0, MAX_LABEL_LENGTH), source: result.source };
    }
  }
  return EMPTY;
}

// ── the chain, most explicit first ──────────────────────────────────────────

function fromAriaLabelledBy(element: HTMLElement, root: Root): ResolvedLabel | null {
  const ids = (element.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
  if (ids.length === 0) return null;

  const parts = ids
    .map((id) => root.getElementById(id))
    .filter((node): node is HTMLElement => node instanceof HTMLElement)
    .map(visibleTextOf)
    .filter(Boolean);

  return parts.length > 0 ? { text: parts.join(' '), source: 'aria-labelledby' } : null;
}

function fromLabelFor(element: HTMLElement, root: Root): ResolvedLabel | null {
  if (!element.id) return null;
  // Scoped to the element's own root — document.querySelector cannot see into a
  // shadow root, and a shadow root cannot see the light DOM.
  //
  // Compared by attribute rather than by a `label[for="…"]` selector: ids in the
  // wild contain characters that need CSS escaping, and CSS.escape is missing in
  // some DOM implementations. There are only ever a handful of labels to scan.
  for (const label of root.querySelectorAll('label')) {
    if (label.getAttribute('for') === element.id) {
      return { text: visibleTextOf(label), source: 'label-for' };
    }
  }
  return null;
}

function fromAncestorLabel(element: HTMLElement): ResolvedLabel | null {
  const label = element.closest('label');
  return label ? { text: visibleTextOf(label), source: 'label-ancestor' } : null;
}

function fromAriaLabel(element: HTMLElement): ResolvedLabel | null {
  const value = element.getAttribute('aria-label');
  return value ? { text: value, source: 'aria-label' } : null;
}

/** For a fieldset or role=radiogroup harvested as a single field, the legend is
 *  the question being asked. */
function fromOwnLegend(element: HTMLElement): ResolvedLabel | null {
  if (element instanceof HTMLFieldSetElement) {
    const legend = element.querySelector('legend');
    if (legend) return { text: visibleTextOf(legend), source: 'legend' };
  }
  return null;
}

function fromPlaceholder(element: HTMLElement): ResolvedLabel | null {
  const value = element.getAttribute('placeholder');
  return value ? { text: value, source: 'placeholder' } : null;
}

/** Last resort. `name="first_name"` is a real signal even with no visible label. */
function fromNameAttribute(element: HTMLElement): ResolvedLabel | null {
  const value = element.getAttribute('name') ?? element.id;
  return value ? { text: value, source: 'name-attribute' } : null;
}

// ── the "nearby text" heuristic ─────────────────────────────────────────────

/**
 * Handles the very common markup where the label is a plain div or span rather
 * than a <label>:
 *
 *   <div class="field"><div class="label">Email</div><input /></div>
 *   <div class="field">Email <input /></div>
 *
 * Climbs at most MAX_CLIMB ancestors and only accepts text from a subtree that
 * contains no other form control — otherwise a field further up the form would
 * lend its label to this one.
 */
function fromPrecedingText(element: HTMLElement): ResolvedLabel | null {
  let node: Element = element;

  for (let depth = 0; depth < MAX_CLIMB; depth++) {
    const parent = node.parentElement;
    if (!parent || parent instanceof HTMLBodyElement || parent instanceof HTMLFormElement) break;

    const text = textBefore(parent, node);
    if (text) return { text, source: 'preceding-text' };

    // Only keep climbing while this really is the control's own wrapper. A
    // parent holding several controls is a section, not a field.
    if (countControls(parent) > 1) break;
    node = parent;
  }
  return null;
}

/** Nearest text that appears before `stopAt` among `parent`'s children. */
function textBefore(parent: Element, stopAt: Element): string | null {
  const candidates: string[] = [];

  for (const child of parent.childNodes) {
    if (child === stopAt || (child instanceof Element && child.contains(stopAt))) break;

    if (child.nodeType === Node.TEXT_NODE) {
      const text = (child.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text) candidates.push(text);
      continue;
    }

    if (child instanceof Element) {
      if (countControls(child) > 0) continue; // that subtree belongs to another field
      const text = visibleTextOf(child);
      if (text && text.length <= MAX_LABEL_LENGTH) candidates.push(text);
    }
  }

  // Nearest wins: the closest preceding text is the most likely label.
  return candidates.length > 0 ? (candidates[candidates.length - 1] ?? null) : null;
}

function countControls(element: Element): number {
  return element.querySelectorAll('input, select, textarea, [contenteditable="true"]').length;
}

// ── group context ───────────────────────────────────────────────────────────

/**
 * The question a control sits underneath. For a radio group the legend usually
 * *is* the question ("Are you legally authorized to work in the US?") while the
 * individual labels are just "Yes"/"No".
 */
export function resolveLegend(element: HTMLElement, root: Root): string {
  const fieldset = element.closest('fieldset');
  const legend = fieldset?.querySelector('legend');
  if (legend) {
    const text = visibleTextOf(legend);
    if (text) return text.slice(0, MAX_LABEL_LENGTH);
  }

  const group = element.closest('[role="group"], [role="radiogroup"]');
  if (group instanceof HTMLElement) {
    const aria = group.getAttribute('aria-label');
    if (aria) return aria.slice(0, MAX_LABEL_LENGTH);

    const labelled = fromAriaLabelledBy(group, root);
    if (labelled && !isBlank(labelled.text)) return labelled.text.slice(0, MAX_LABEL_LENGTH);
  }

  return '';
}
