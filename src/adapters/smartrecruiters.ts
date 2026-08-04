import { comboboxFiller } from './combobox';
import { companyFromPath, formRootFrom, hostMatches, textFrom } from './helpers';
import type { SiteAdapter } from './types';

/**
 * SmartRecruiters — jobs.smartrecruiters.com/{company}/{posting} and the
 * careers.smartrecruiters.com variant.
 */
export const smartRecruitersAdapter: SiteAdapter = {
  name: 'SmartRecruiters',

  matches(location) {
    return hostMatches(location, ['smartrecruiters.com']);
  },

  formRoot(doc) {
    return formRootFrom(doc, ['#st-app form', 'form[name="application"]', 'main form', 'form']);
  },

  jobMeta(doc, location) {
    return {
      company:
        textFrom(doc, ['[itemprop="hiringOrganization"]', '.company-name'], 80) ||
        companyFromPath(location, 0),
      role: textFrom(doc, ['[itemprop="title"]', 'h1'], 140),
    };
  },

  fillField: comboboxFiller(),
};
