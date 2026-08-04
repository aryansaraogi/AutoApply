import { comboboxFiller } from './combobox';
import { companyFromPath, formRootFrom, hostMatches, textFrom } from './helpers';
import type { SiteAdapter } from './types';

/**
 * Lever — jobs.lever.co/{company}/{posting}/apply.
 *
 * Lever's inputs carry terse names (`name`, `org`, `urls[LinkedIn]`) but always
 * ship a visible placeholder, which the label chain picks up — so the shared
 * rules handle the fields without any Lever-specific mapping here.
 */
export const leverAdapter: SiteAdapter = {
  name: 'Lever',

  matches(location) {
    return hostMatches(location, ['lever.co']);
  },

  formRoot(doc) {
    return formRootFrom(doc, ['form.application-form', 'form[action*="apply"]', '.application']);
  },

  jobMeta(doc, location) {
    return {
      company:
        textFrom(doc, ['.main-header-logo img[alt]', '.posting-header .company'], 80) ||
        companyFromPath(location, 0),
      role: textFrom(doc, ['.posting-headline h2', '.posting-header h2', 'h2', 'h1'], 140),
    };
  },

  fillField: comboboxFiller(),
};
