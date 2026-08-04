import { comboboxFiller } from './combobox';
import { companyFromPath, formRootFrom, hostMatches, textFrom } from './helpers';
import type { SiteAdapter } from './types';

/**
 * Ashby — jobs.ashbyhq.com/{company}/{posting}/application.
 *
 * A React app with hashed class names, so there is nothing stable to select on
 * beyond the URL and the document heading. Field identification is left entirely
 * to the shared rules, which work because Ashby labels its inputs properly with
 * aria-labelledby.
 */
export const ashbyAdapter: SiteAdapter = {
  name: 'Ashby',

  matches(location) {
    return hostMatches(location, ['ashbyhq.com']);
  },

  formRoot(doc) {
    return formRootFrom(doc, ['form']);
  },

  jobMeta(doc, location) {
    return {
      company: companyFromPath(location, 0),
      role: textFrom(doc, ['h1', '[class*="jobTitle"]'], 140),
    };
  },

  fillField: comboboxFiller(),
};
