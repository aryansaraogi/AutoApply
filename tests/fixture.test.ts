/**
 * End-to-end pass over the sample fixture.
 *
 * The unit tests check each stage in isolation; this one checks that the whole
 * chain — harvest, match, fill — produces the right result on a page built the
 * way real ATS forms are built, including the decoys planted in the fixture.
 */

import { beforeEach, describe, expect, it } from 'vitest';

// Vite's ?raw import keeps this working under jsdom, where import.meta.url is
// not a file: URL and node:fs path resolution falls over.
import FIXTURE from '../fixtures/sample-application.html?raw';

import { genericAdapter } from '@/adapters/generic';
import { fillFields } from '@/core/fill';
import { harvest } from '@/core/harvest';
import { extractJobMeta } from '@/core/jobMeta';
import type { FieldReport } from '@/core/types';
import { emptyProfile, type Profile } from '@/storage/schema';

const PROFILE: Profile = {
  ...emptyProfile(),
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  phone: '+1 555 010 1842',
  city: 'London',
  country: 'United Kingdom',
  linkedin: 'https://linkedin.com/in/ada',
  github: 'https://github.com/ada',
  portfolio: 'https://ada.dev',
  currentCompany: 'Analytical Engines Ltd',
  currentTitle: 'Principal Engineer',
  yearsExperience: '12',
  desiredSalary: '$185,000',
  earliestStartDate: '2026-09-01',
  workAuthorized: 'Yes',
  requiresSponsorship: 'No',
  gender: 'Female',
  veteranStatus: 'I am not a protected veteran',
  disabilityStatus: 'No, I do not have a disability and have not had one in the past',
  pronouns: 'she/her',
  howHeard: 'LinkedIn',
  coverLetter: 'I have spent twelve years building platform tooling…',
};

function loadFixture(): void {
  // The fixture's inline script builds the shadow-DOM widget, so it has to run.
  document.documentElement.innerHTML = FIXTURE;
  for (const script of document.querySelectorAll('script')) {
    const replacement = document.createElement('script');
    replacement.textContent = script.textContent;
    script.replaceWith(replacement);
  }
}

function valueOf(selector: string): string {
  const node = document.querySelector(selector);
  if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) return node.value;
  if (node instanceof HTMLSelectElement) return node.value;
  throw new Error(`no value-bearing element at ${selector}`);
}

function reportFor(reports: FieldReport[], needle: string): FieldReport {
  const match = reports.find((r) => r.label.toLowerCase().includes(needle.toLowerCase()));
  if (!match) {
    throw new Error(
      `no report for "${needle}". Saw: ${reports.map((r) => r.label).join(' | ')}`,
    );
  }
  return match;
}

let reports: FieldReport[];
let filled: number;
let requiredUnfilled: number;

beforeEach(async () => {
  loadFixture();
  const root = genericAdapter.formRoot?.(document) ?? document;
  const result = await fillFields(harvest(root), PROFILE, { overwrite: false });
  reports = result.reports;
  filled = result.filled;
  requiredUnfilled = result.requiredUnfilled;
});

describe('fixture: fields that should be filled', () => {
  it('fills identity and contact details', () => {
    expect(valueOf('#first_name')).toBe('Ada');
    expect(valueOf('#last_name')).toBe('Lovelace');
    expect(valueOf('#contact')).toBe('ada@example.com');
    expect(valueOf('[name="phone"]')).toBe('+1 555 010 1842');
    expect(valueOf('#city')).toBe('London');
  });

  it('picks the exact country option rather than a longer prefix match', () => {
    expect(valueOf('[name="country"]')).toBe('gb');
  });

  it('fills links without confusing the company website decoy', () => {
    expect(valueOf('#li')).toBe('https://linkedin.com/in/ada');
    expect(valueOf('#gh')).toBe('https://github.com/ada');
    expect(valueOf('#site')).toBe('');
  });

  it('fills the current role but leaves the previous employer alone', () => {
    expect(valueOf('#co')).toBe('Analytical Engines Ltd');
    expect(valueOf('#title')).toBe('Principal Engineer');
    expect(valueOf('#prev')).toBe('');
  });

  it('normalises numbers and dates for typed inputs', () => {
    expect(valueOf('#yrs')).toBe('12');
    expect(valueOf('#sal')).toBe('185000');
    expect(valueOf('#start')).toBe('2026-09-01');
  });

  it('answers authorization and sponsorship independently', () => {
    const checked = (selector: string) =>
      (document.querySelector(selector) as HTMLInputElement).checked;
    expect(checked('[name="work_auth"][value="Yes"]')).toBe(true);
    expect(checked('[name="sponsorship"][value="No"]')).toBe(true);
  });

  it('selects the verbatim EEO wordings', () => {
    expect(valueOf('#gender')).toBe('Female');
    expect(valueOf('#vet')).toBe('I am not a protected veteran');
    expect(valueOf('#dis')).toBe(
      'No, I do not have a disability and have not had one in the past',
    );
  });

  it('fills the shadow-DOM widget', () => {
    const shadow = document.getElementById('shadow-host')?.shadowRoot;
    const input = shadow?.getElementById('pronouns') as HTMLInputElement;
    expect(input.value).toBe('she/her');
  });
});

describe('fixture: fields that must be left alone', () => {
  it('refuses the password field', () => {
    expect(reportFor(reports, 'password').status).toBe('unsupported');
    expect(valueOf('#pw')).toBe('');
  });

  it('never ticks the consent checkbox', () => {
    expect((document.querySelector('[name="consent"]') as HTMLInputElement).checked).toBe(false);
  });

  it('flags the résumé upload rather than filling it, with no résumé saved', () => {
    // The fixture pass runs without a stored résumé, so the upload is reported
    // as something the user still has to handle — not silently ignored.
    expect(reportFor(reports, 'Resume').status).toBe('no-value');
  });

  it('leaves the open-ended essay question for the user and flags it', () => {
    const essay = reportFor(reports, 'Why do you want to work here');
    expect(essay.status).toBe('unmatched');
    expect(essay.required).toBe(true);
    expect(valueOf('#why')).toBe('');
  });
});

describe('fixture: summary and metadata', () => {
  it('fills the great majority of answerable fields', () => {
    // 20 answerable fields in the fixture; the rest are decoys or user-only.
    expect(filled).toBeGreaterThanOrEqual(20);
  });

  it('counts the required fields it could not answer', () => {
    // "Why do you want to work here?" and the consent checkbox.
    expect(requiredUnfilled).toBe(2);
  });

  it('extracts the company and role for the history entry', () => {
    const meta = extractJobMeta(document);
    expect(meta.company).toBe('Northwind Labs');
    expect(meta.role).toBe('Senior Platform Engineer');
  });
});
