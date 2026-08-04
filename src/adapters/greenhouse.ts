import { comboboxFiller } from './combobox';
import { companyFromPath, formRootFrom, hostMatches, textFrom } from './helpers';
import type { SiteAdapter } from './types';

/**
 * Greenhouse — boards.greenhouse.io, job-boards.greenhouse.io, and the embedded
 * iframe that company career pages drop in.
 *
 * The embed is why the manifest declares all_frames: on a company careers page
 * the application lives inside an iframe served from greenhouse.io, so this
 * adapter runs in that frame rather than the top one.
 */
export const greenhouseAdapter: SiteAdapter = {
  name: 'Greenhouse',

  matches(location, doc) {
    if (hostMatches(location, ['greenhouse.io'])) return true;
    // Embedded on a company domain: the board injects these containers.
    return doc.querySelector('#grnhse_app, #application_form') !== null;
  },

  formRoot(doc) {
    return formRootFrom(doc, [
      '#application_form',
      '#application-form',
      'form[action*="greenhouse"]',
      '#grnhse_app form',
    ]);
  },

  jobMeta(doc, location) {
    const company =
      textFrom(doc, ['.company-name', '[class*="company-name"]'], 80).replace(/^at\s+/i, '') ||
      companyFromPath(location, 0);

    return {
      company,
      role: textFrom(doc, ['.app-title', '.job__title h1', 'h1'], 140),
    };
  },

  fillField: comboboxFiller(),
};
