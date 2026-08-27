/**
 * The three extension pages each build their DOM by hand — there is no framework
 * here and no runtime dependency that could add one. These are the two helpers
 * all of them need, kept in one place so the pages cannot drift apart on them.
 */

/**
 * Looks up an element the page's markup guarantees exists.
 *
 * Throws rather than returning null: a missing id means the HTML and the script
 * have gone out of step, which is a build-time mistake worth failing loudly on
 * rather than a runtime condition worth handling.
 */
export function must<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

/** `el('button', { className: 'primary' }, ['Fill'])` — createElement with props. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) node.append(child);
  return node;
}

/** Trailing-edge debounce. Used for typing into the profile form and the tracker. */
export function debounce<T extends unknown[]>(
  fn: (...args: T) => void,
  ms: number,
): (...args: T) => void {
  let timer = 0;
  return (...args: T) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  };
}
