import type { SiteAdapter } from './types';

/**
 * The fallback. Harvests the whole document and relies entirely on the shared
 * rules — which is enough for any form built from plain HTML controls.
 */
export const genericAdapter: SiteAdapter = {
  name: 'Generic',
  matches: () => true,

  formRoot(doc) {
    // Prefer the largest form on the page: job pages often carry a newsletter or
    // search form too, and harvesting those adds noise to the review list.
    const forms = [...doc.querySelectorAll('form')];
    if (forms.length === 0) return doc;

    let best = forms[0] as HTMLFormElement;
    let bestCount = countControls(best);
    for (const form of forms.slice(1)) {
      const count = countControls(form);
      if (count > bestCount) {
        best = form;
        bestCount = count;
      }
    }
    // A form with almost nothing in it is probably not the application.
    return bestCount >= 3 ? best : doc;
  },
};

function countControls(root: ParentNode): number {
  return root.querySelectorAll('input, select, textarea, [contenteditable="true"]').length;
}
