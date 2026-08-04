import { comboboxFiller } from './combobox';
import { formRootFrom, hostMatches, textFrom, titleCase } from './helpers';
import type { SiteAdapter } from './types';

/**
 * Workday — {tenant}.wd{n}.myworkdayjobs.com.
 *
 * The hardest of the supported targets, for two reasons.
 *
 * Its markup carries no stable classes or ids; the one durable hook is
 * `data-automation-id`, Workday's own test-automation attribute, which is why
 * every selector here keys off it.
 *
 * And an application is a multi-page wizard rather than one long form. The user
 * clicks Next themselves, so each page is simply a fresh fill — the adapter
 * reports which step is showing so the sidepanel can say so.
 */
export const workdayAdapter: SiteAdapter = {
  name: 'Workday',

  matches(location, doc) {
    if (hostMatches(location, ['myworkdayjobs.com', 'workday.com'])) return true;
    return doc.querySelector('[data-automation-id="applyFlowPage"]') !== null;
  },

  formRoot(doc) {
    return formRootFrom(doc, [
      '[data-automation-id="applyFlowPage"]',
      '[data-automation-id="jobApplication"]',
      'main',
    ]);
  },

  jobMeta(doc, location) {
    return {
      // The tenant subdomain is the employer, and unlike the page chrome it does
      // not move between Workday releases.
      company: tenantFrom(location) || textFrom(doc, ['[data-automation-id="company"]'], 80),
      role: textFrom(
        doc,
        ['[data-automation-id="jobPostingHeader"]', '[data-automation-id="jobTitle"]', 'h1'],
        140,
      ),
    };
  },

  step(doc) {
    const bar = doc.querySelector('[data-automation-id="progressBar"]');
    if (!bar) return null;

    const steps = [...bar.querySelectorAll('[data-automation-id^="progressBar"]')];
    if (steps.length === 0) return null;

    const activeIndex = steps.findIndex(
      (node) =>
        node.getAttribute('aria-current') === 'step' ||
        node.getAttribute('data-automation-id') === 'progressBarActiveStep',
    );
    if (activeIndex < 0) return null;

    return { current: activeIndex + 1, total: steps.length };
  },

  // Workday's pickers render menu items as promptOption rather than role=option,
  // and can take a moment to fetch remote lists such as country or state.
  fillField: comboboxFiller({
    optionSelector: '[role="option"], [data-automation-id="promptOption"]',
    timeoutMs: 2500,
  }),
};

/** "acme.wd1.myworkdayjobs.com" → "Acme". */
function tenantFrom(location: Location): string {
  const [tenant] = location.hostname.split('.');
  if (!tenant || /^wd\d+$/.test(tenant) || tenant === 'www') return '';
  return titleCase(tenant);
}
