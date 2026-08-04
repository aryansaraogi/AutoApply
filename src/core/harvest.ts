/**
 * Finds every fillable control on the page and describes it.
 *
 * Scope note: a harvest covers one document. The content script is declared with
 * `all_frames`, so an application embedded in an iframe (Greenhouse does this)
 * is harvested by that frame's own copy of the script rather than by reaching
 * across the boundary — which also means cross-origin frames need no special
 * handling. Open shadow roots *are* traversed, since those live in the same
 * document.
 */

import { resolveLabel, resolveLegend } from './label';
import { canonicalize, visibleTextOf } from './normalize';
import type { ControlKind, FieldDescriptor, FieldOption } from './types';

type Root = Document | ShadowRoot;

const CONTROL_SELECTOR = 'input, select, textarea, [contenteditable="true"], [role="combobox"]';

/** Input types that are not data entry. */
const NON_DATA_INPUT_TYPES = new Set([
  'hidden',
  'submit',
  'button',
  'reset',
  'image',
]);

export function harvest(scope: ParentNode = document): FieldDescriptor[] {
  const elements = [...walk(scope)].filter(isCandidate);

  const descriptors: FieldDescriptor[] = [];
  const claimed = new Set<Element>();
  let index = 0;

  // Radios first: a group of them is one logical question, and claiming them up
  // front stops the single-control pass from emitting one field per radio.
  for (const group of groupRadios(elements)) {
    for (const radio of group.members) claimed.add(radio);
    descriptors.push(describeRadioGroup(group, `f${index++}`));
  }

  for (const element of elements) {
    if (claimed.has(element)) continue;
    if (element instanceof HTMLInputElement && element.type === 'radio') continue;
    descriptors.push(describeSingle(element, `f${index++}`));
  }

  return descriptors;
}

// ── traversal ───────────────────────────────────────────────────────────────

/** Yields matching elements in `root`, descending into any open shadow roots. */
function* walk(root: ParentNode): Generator<HTMLElement> {
  for (const element of root.querySelectorAll<HTMLElement>('*')) {
    if (element.matches(CONTROL_SELECTOR)) yield element;
    const shadow = element.shadowRoot;
    if (shadow) yield* walk(shadow);
  }
}

/** The root the element actually lives in — its shadow root, or the document. */
function rootOf(element: Element): Root {
  const root = element.getRootNode();
  return root instanceof ShadowRoot || root instanceof Document ? root : document;
}

// ── candidate filtering ─────────────────────────────────────────────────────

function isCandidate(element: HTMLElement): boolean {
  if (element instanceof HTMLInputElement && NON_DATA_INPUT_TYPES.has(element.type)) return false;
  if (isDisabled(element)) return false;
  if (element.closest('[aria-hidden="true"], [inert]')) return false;
  return isVisible(element);
}

function isDisabled(element: HTMLElement): boolean {
  if (element.getAttribute('aria-disabled') === 'true') return true;
  // readOnly is as good as disabled for our purposes — we cannot type into it.
  // HTMLSelectElement has no readOnly, hence the separate branch.
  if (element instanceof HTMLSelectElement) return element.disabled;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.disabled || element.readOnly;
  }
  return false;
}

/**
 * Radios and checkboxes are routinely hidden with opacity or clip tricks and
 * drawn by a styled sibling, so an invisible box does not mean an unusable
 * control. They only count as gone when they are display:none.
 */
function isVisible(element: HTMLElement): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view) return true;

  // Walk the chain rather than trusting the element's own computed style:
  // display:none on an ancestor is what actually removes a field, and not every
  // DOM implementation propagates that down to descendants' computed styles.
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.hidden) return false;
    const style = view.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }

  const isToggle =
    element instanceof HTMLInputElement && (element.type === 'radio' || element.type === 'checkbox');
  if (isToggle) return true;

  // Box geometry is the more accurate test, but only where layout actually runs.
  // Under a non-rendering DOM (tests) every box is 0×0, which would hide the
  // entire form — so fall back to the style chain we just walked.
  if (!hasLayout(element.ownerDocument)) return true;
  return element.offsetParent !== null || element.getClientRects().length > 0;
}

function hasLayout(doc: Document): boolean {
  return (doc.body?.getClientRects().length ?? 0) > 0;
}

// ── radio grouping ──────────────────────────────────────────────────────────

interface RadioGroup {
  key: string;
  members: HTMLInputElement[];
  container: HTMLElement;
}

function groupRadios(elements: HTMLElement[]): RadioGroup[] {
  const radios = elements.filter(
    (el): el is HTMLInputElement => el instanceof HTMLInputElement && el.type === 'radio',
  );

  const groups = new Map<string, HTMLInputElement[]>();
  for (const radio of radios) {
    // Radios share a group by name within a form. Unnamed radios (rare, but they
    // exist in hand-rolled widgets) fall back to their nearest group container.
    const scope = radio.form?.name || radio.form?.id || 'doc';
    const container = groupContainerFor(radio);
    const key = radio.name
      ? `${scope}::name::${radio.name}`
      : `${scope}::node::${nodeKey(container)}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(radio);
    else groups.set(key, [radio]);
  }

  return [...groups].map(([key, members]) => ({
    key,
    members,
    // members[0] is always present: a bucket is only created with an element in it.
    container: groupContainerFor(members[0] as HTMLInputElement),
  }));
}

function groupContainerFor(radio: HTMLInputElement): HTMLElement {
  const explicit = radio.closest<HTMLElement>('fieldset, [role="radiogroup"], [role="group"]');
  return explicit ?? radio.parentElement ?? radio;
}

const nodeKeys = new WeakMap<Element, string>();
let nodeKeySeq = 0;

function nodeKey(element: Element): string {
  let key = nodeKeys.get(element);
  if (!key) {
    key = `n${nodeKeySeq++}`;
    nodeKeys.set(element, key);
  }
  return key;
}

function describeRadioGroup(group: RadioGroup, id: string): FieldDescriptor {
  const first = group.members[0] as HTMLInputElement;
  const root = rootOf(first);

  const legend = resolveLegend(first, root);
  const containerLabel = resolveLabel(group.container, root);
  // The question lives on the group; "Yes"/"No" live on the individual radios.
  const label = legend || containerLabel.text || first.name;

  const options: FieldOption[] = group.members.map((radio) => ({
    value: radio.value,
    label: resolveLabel(radio, root).text || radio.value,
    element: radio,
  }));

  return {
    id,
    element: group.container,
    kind: 'radiogroup',
    name: first.name,
    domId: group.container.id,
    autocomplete: '',
    placeholder: '',
    ariaLabel: group.container.getAttribute('aria-label') ?? '',
    label,
    normalizedLabel: canonicalize(label),
    labelSource: legend ? 'legend' : containerLabel.source,
    legend,
    required: group.members.some((radio) => radio.required),
    options,
    hasValue: group.members.some((radio) => radio.checked),
    frameUrl: location.href,
  };
}

// ── single controls ─────────────────────────────────────────────────────────

function describeSingle(element: HTMLElement, id: string): FieldDescriptor {
  const root = rootOf(element);
  const resolved = resolveLabel(element, root);
  const legend = resolveLegend(element, root);
  const kind = kindOf(element);

  // A bare "Yes"/"No" label under a legend tells us nothing on its own; the
  // legend is the actual question, so match against both.
  const matchText =
    legend && legend !== resolved.text ? `${legend} ${resolved.text}` : resolved.text;

  return {
    id,
    element,
    kind,
    name: element.getAttribute('name') ?? '',
    domId: element.id,
    autocomplete: (element.getAttribute('autocomplete') ?? '').toLowerCase().trim(),
    placeholder: element.getAttribute('placeholder') ?? '',
    ariaLabel: element.getAttribute('aria-label') ?? '',
    label: resolved.text,
    normalizedLabel: canonicalize(matchText),
    labelSource: resolved.source,
    legend,
    required: isRequired(element),
    options: optionsOf(element),
    hasValue: hasValue(element),
    frameUrl: location.href,
  };
}

function kindOf(element: HTMLElement): ControlKind {
  if (element.getAttribute('role') === 'combobox') return 'combobox';
  if (element instanceof HTMLSelectElement) return 'select';
  if (element instanceof HTMLTextAreaElement) return 'textarea';

  if (element instanceof HTMLInputElement) {
    switch (element.type) {
      case 'email':
        return 'email';
      case 'tel':
        return 'tel';
      case 'url':
        return 'url';
      case 'number':
        return 'number';
      case 'date':
      case 'month':
        return 'date';
      case 'checkbox':
        return 'checkbox';
      case 'file':
        return 'file';
      default:
        // Some autocomplete widgets are a plain text input wearing ARIA.
        return element.getAttribute('aria-autocomplete') ? 'combobox' : 'text';
    }
  }

  if (element.getAttribute('contenteditable') === 'true') return 'contenteditable';
  return 'text';
}

function isRequired(element: HTMLElement): boolean {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    if (element.required) return true;
  }
  return element.getAttribute('aria-required') === 'true';
}

function optionsOf(element: HTMLElement): FieldOption[] {
  if (element instanceof HTMLSelectElement) {
    return [...element.options].map((option) => ({
      value: option.value,
      label: (option.textContent ?? '').trim(),
      element: option,
    }));
  }

  // An ARIA combobox points at its listbox; the options may not be rendered yet,
  // in which case this is empty and the adapter opens the menu at fill time.
  const listboxId = element.getAttribute('aria-controls') ?? element.getAttribute('aria-owns');
  if (listboxId) {
    const listbox = rootOf(element).getElementById(listboxId);
    if (listbox) {
      return [...listbox.querySelectorAll<HTMLElement>('[role="option"]')].map((option) => ({
        value: option.getAttribute('data-value') ?? visibleTextOf(option),
        label: visibleTextOf(option),
        element: option,
      }));
    }
  }

  return [];
}

function hasValue(element: HTMLElement): boolean {
  if (element instanceof HTMLSelectElement) {
    const selected = element.selectedOptions[0];
    // A placeholder option ("Select…") counts as empty — its value is blank.
    return selected !== undefined && selected.value.trim() !== '';
  }
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox') return element.checked;
    return element.value.trim() !== '';
  }
  if (element instanceof HTMLTextAreaElement) return element.value.trim() !== '';
  if (element.getAttribute('contenteditable') === 'true') {
    return (element.textContent ?? '').trim() !== '';
  }
  return false;
}
