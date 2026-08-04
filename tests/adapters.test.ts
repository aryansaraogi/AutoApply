/**
 * Adapter routing.
 *
 * The selectors inside each adapter are best-effort against markup that vendors
 * reskin without notice, and they fall back to the generic path when they miss.
 * What must not silently break is *routing* — sending a Lever page to the
 * Workday adapter would apply the wrong widget driver — so that is what these
 * cover, along with the URL-derived company names that survive a redesign.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { pickAdapter } from '@/adapters/registry';
import { genericAdapter } from '@/adapters/generic';
import { mount } from './helpers';

/** A stand-in for Location; adapters only read hostname and pathname. */
function locationFor(url: string): Location {
  return new URL(url) as unknown as Location;
}

function adapterFor(url: string, html = ''): string {
  mount(html);
  return pickAdapter(locationFor(url), document).name;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('routing by hostname', () => {
  const cases: [string, string][] = [
    ['https://boards.greenhouse.io/acme/jobs/4012345', 'Greenhouse'],
    ['https://job-boards.greenhouse.io/acme/jobs/4012345', 'Greenhouse'],
    ['https://jobs.lever.co/acme/8f2c-1234/apply', 'Lever'],
    ['https://jobs.ashbyhq.com/acme/abcd-1234/application', 'Ashby'],
    ['https://apply.workable.com/acme/j/ABCDEF/apply/', 'Workable'],
    ['https://jobs.smartrecruiters.com/Acme/744000012345', 'SmartRecruiters'],
    ['https://acme.wd1.myworkdayjobs.com/en-US/careers/job/Engineer', 'Workday'],
    ['https://acme.wd5.myworkdayjobs.com/External/job/London/Engineer', 'Workday'],
  ];

  for (const [url, expected] of cases) {
    it(`routes ${new URL(url).hostname} to ${expected}`, () => {
      expect(adapterFor(url)).toBe(expected);
    });
  }

  it('falls back to the generic adapter on an unknown site', () => {
    expect(adapterFor('https://careers.example.com/apply')).toBe(genericAdapter.name);
  });

  it('does not let one ATS claim another', () => {
    expect(adapterFor('https://jobs.lever.co/acme/1/apply')).not.toBe('Greenhouse');
    expect(adapterFor('https://apply.workable.com/acme/j/1/apply')).not.toBe('Workday');
  });

  it('is not fooled by an ATS name appearing elsewhere in the host', () => {
    // A lookalike domain must not be treated as the real thing.
    expect(adapterFor('https://greenhouse.io.example.com/apply')).toBe(genericAdapter.name);
  });
});

describe('routing by DOM signature', () => {
  it('detects a Greenhouse board embedded on a company domain', () => {
    const name = adapterFor(
      'https://www.acme.com/careers/engineer',
      `<div id="grnhse_app"><form id="application_form"><input name="first_name" /></form></div>`,
    );
    expect(name).toBe('Greenhouse');
  });

  it('detects a Workday apply flow by its automation id', () => {
    const name = adapterFor(
      'https://careers.acme.com/apply',
      `<div data-automation-id="applyFlowPage"><input /></div>`,
    );
    expect(name).toBe('Workday');
  });
});

describe('company and role extraction', () => {
  /** Routes the URL to its adapter and asks that adapter to describe the job. */
  function metaFor(url: string, html: string) {
    mount(html);
    const where = locationFor(url);
    return pickAdapter(where, document).jobMeta?.(document, where);
  }

  it('reads the employer from the Lever path segment', () => {
    const meta = metaFor(
      'https://jobs.lever.co/northwind/abc/apply',
      `<div class="posting-headline"><h2>Staff Engineer</h2></div>`,
    );
    expect(meta?.company).toBe('Northwind');
    expect(meta?.role).toBe('Staff Engineer');
  });

  it('reads the employer from the Workday tenant subdomain', () => {
    const meta = metaFor(
      'https://northwind-labs.wd3.myworkdayjobs.com/en-US/careers',
      `<h1>Platform Engineer</h1>`,
    );
    expect(meta?.company).toBe('Northwind Labs');
    expect(meta?.role).toBe('Platform Engineer');
  });

  it('title-cases a hyphenated Ashby slug', () => {
    const meta = metaFor('https://jobs.ashbyhq.com/north-wind/x', `<h1>Senior SRE</h1>`);
    expect(meta?.company).toBe('North Wind');
  });
});

describe('generic form-root selection', () => {
  it('prefers the application form over a search box', () => {
    mount(`
      <form id="search"><input name="q" /></form>
      <form id="application">
        <input name="first_name" /><input name="last_name" />
        <input name="email" /><textarea name="cover"></textarea>
      </form>
    `);
    const root = genericAdapter.formRoot?.(document) as HTMLElement;
    expect(root.id).toBe('application');
  });

  it('falls back to the whole document when no form is substantial', () => {
    mount(`<form id="search"><input name="q" /></form><input name="stray" />`);
    expect(genericAdapter.formRoot?.(document)).toBe(document);
  });
});

describe('Workday step detection', () => {
  it('reports the active step from the progress bar', () => {
    const name = adapterFor(
      'https://acme.wd1.myworkdayjobs.com/careers',
      `
        <div data-automation-id="progressBar">
          <div data-automation-id="progressBarStep">My Information</div>
          <div data-automation-id="progressBarStep" aria-current="step">My Experience</div>
          <div data-automation-id="progressBarStep">Review</div>
        </div>
      `,
    );
    expect(name).toBe('Workday');

    const adapter = pickAdapter(locationFor('https://acme.wd1.myworkdayjobs.com/careers'), document);
    expect(adapter.step?.(document)).toEqual({ current: 2, total: 3 });
  });

  it('returns null when there is no progress bar to read', () => {
    mount(`<div><input /></div>`);
    const adapter = pickAdapter(locationFor('https://acme.wd1.myworkdayjobs.com/careers'), document);
    expect(adapter.step?.(document)).toBeNull();
  });
});
