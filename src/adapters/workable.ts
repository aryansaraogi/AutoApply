import { comboboxFiller } from './combobox';
import { companyFromPath, formRootFrom, hostMatches, textFrom } from './helpers';
import type { SiteAdapter } from './types';

/**
 * Workable — apply.workable.com/{company}/j/{posting}/apply.
 */
export const workableAdapter: SiteAdapter = {
  name: 'Workable',

  matches(location) {
    return hostMatches(location, ['workable.com']);
  },

  formRoot(doc) {
    return formRootFrom(doc, ['form[data-ui="application-form"]', 'main form', 'form']);
  },

  jobMeta(doc, location) {
    return {
      company:
        textFrom(doc, ['[data-ui="company-name"]', 'header [class*="company"]'], 80) ||
        companyFromPath(location, 0),
      role: textFrom(doc, ['[data-ui="job-title"]', 'h1'], 140),
    };
  },

  fillField: comboboxFiller(),
};
