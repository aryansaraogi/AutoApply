/**
 * Job identification.
 *
 * The cases here are taken from real tracker rows that came out wrong: a
 * marketing headline as the role, a bare "Apply" as the role, and Greenhouse's
 * "embed" routing segment as the employer. Careers pages are not built to be
 * read this way, so the rule throughout is that a bad guess is worse than a
 * blank field — the tracker lets the user correct either.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { cleanCompany, extractJobMeta, isJunkRole, splitRoleAndCompany } from '@/core/jobMeta';

function locationFor(url: string): Location {
  return new URL(url) as unknown as Location;
}

function metaFor(html: string, url = 'https://example.com/careers/engineer') {
  document.documentElement.innerHTML = `<head></head><body>${html}</body>`;
  return extractJobMeta(document, locationFor(url));
}

beforeEach(() => {
  document.documentElement.innerHTML = '<head></head><body></body>';
});

describe('the rows that came out wrong', () => {
  it('reads the role and employer out of a Greenhouse application title', () => {
    // Was: role "Job Application for Software Engineer, Intern at Stripe",
    // company "Embed" — the routing segment of /embed/job_app.
    const result = metaFor(
      `<h1>Apply</h1>`,
      'https://boards.greenhouse.io/embed/job_app?token=123',
    );
    document.title = 'Job Application for Software Engineer, Intern at Stripe';

    const again = extractJobMeta(
      document,
      locationFor('https://boards.greenhouse.io/embed/job_app?token=123'),
    );
    expect(again.role).toBe('Software Engineer, Intern');
    expect(again.company).toBe('Stripe');
    expect(result.company).not.toBe('Embed');
  });

  it('refuses a bare "Apply" heading as the role', () => {
    const result = metaFor(`<h1>Apply</h1>`, 'https://careers.cisco.com/jobs/apply');
    expect(result.role).toBe('');
  });

  it('finds the employer behind a careers subdomain', () => {
    // Was: company "careers.cisco.com", the raw host.
    const result = metaFor(`<h1>Apply</h1>`, 'https://careers.cisco.com/jobs/apply');
    expect(result.company).toBe('Cisco');
  });

  it('refuses a marketing headline as the role', () => {
    const result = metaFor(
      `<h1>Begin your 10x journey with Juspay!</h1>`,
      'https://juspay.io/joinus',
    );
    expect(result.role).toBe('');
  });

  it('does not take "joinus" from the path as the employer', () => {
    const result = metaFor(`<h1>Let's get started</h1>`, 'https://juspay.io/joinus');
    expect(result.company).toBe('Juspay');
  });

  it('still keeps a role that was already right', () => {
    const result = metaFor(
      `<h1>Junior Software Engineer</h1>`,
      'https://jobs.lever.co/loginext/abc',
    );
    expect(result.role).toBe('Junior Software Engineer');
    expect(result.company).toBe('Loginext');
  });
});

describe('structured data wins', () => {
  it('prefers a JobPosting block over the page heading', () => {
    const result = metaFor(
      `<h1>Begin your 10x journey!</h1>
       <script type="application/ld+json">${JSON.stringify({
         '@context': 'https://schema.org',
         '@type': 'JobPosting',
         title: 'Software Development Engineer, Backend',
         hiringOrganization: { '@type': 'Organization', name: 'Juspay' },
       })}</script>`,
      'https://juspay.io/joinus',
    );
    expect(result.role).toBe('Software Development Engineer, Backend');
    expect(result.company).toBe('Juspay');
  });

  it('reads a JobPosting nested in an @graph', () => {
    const result = metaFor(
      `<script type="application/ld+json">${JSON.stringify({
         '@graph': [
           { '@type': 'WebSite', name: 'Careers' },
           {
             '@type': 'JobPosting',
             title: 'Platform Engineer',
             hiringOrganization: { name: 'Northwind' },
           },
         ],
       })}</script>`,
    );
    expect(result.role).toBe('Platform Engineer');
    expect(result.company).toBe('Northwind');
  });

  it('survives a malformed block and uses a later valid one', () => {
    const result = metaFor(
      `<script type="application/ld+json">{ not json </script>
       <script type="application/ld+json">${JSON.stringify({
         '@type': 'JobPosting',
         title: 'Data Engineer',
         hiringOrganization: { name: 'Acme' },
       })}</script>`,
    );
    expect(result.role).toBe('Data Engineer');
    expect(result.company).toBe('Acme');
  });
});

describe('splitRoleAndCompany', () => {
  it('splits the Greenhouse application title', () => {
    expect(splitRoleAndCompany('Job Application for Staff Engineer at Acme')).toEqual({
      role: 'Staff Engineer',
      company: 'Acme',
    });
  });

  it('splits a plain "role at company"', () => {
    expect(splitRoleAndCompany('Backend Engineer at Northwind Labs')).toEqual({
      role: 'Backend Engineer',
      company: 'Northwind Labs',
    });
  });

  it('returns nothing for a title with no separator', () => {
    expect(splitRoleAndCompany('Senior Platform Engineer')).toEqual({});
  });
});

describe('isJunkRole', () => {
  for (const junk of ['Apply', 'apply now', 'Careers', 'Join us', 'Submit application', '']) {
    it(`rejects "${junk}"`, () => expect(isJunkRole(junk)).toBe(true));
  }

  it('rejects anything with an exclamation mark, which is always marketing', () => {
    expect(isJunkRole('Come build the future with us!')).toBe(true);
  });

  it('accepts a genuine job title', () => {
    expect(isJunkRole('Senior Backend Engineer, Payments')).toBe(false);
  });
});

describe('cleanCompany', () => {
  it('rejects routing words', () => {
    expect(cleanCompany('Embed')).toBe('');
    expect(cleanCompany('Join us')).toBe('');
    expect(cleanCompany('Careers')).toBe('');
  });

  it('keeps a real employer name', () => {
    expect(cleanCompany('Northwind Labs')).toBe('Northwind Labs');
  });
});

describe('falling back cleanly', () => {
  it('returns blank rather than guessing when there is nothing to read', () => {
    const result = metaFor(`<div>no headings here</div>`, 'https://careers.example.com/x');
    expect(result.role).toBe('');
  });

  it('never returns a public suffix as the employer', () => {
    const result = metaFor(`<h1>Apply</h1>`, 'https://jobs.co/apply');
    expect(result.company).not.toBe('Co');
  });
});
