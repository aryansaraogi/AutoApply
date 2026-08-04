import { beforeEach, describe, expect, it } from 'vitest';
import { harvest } from '@/core/harvest';
import { fillFields } from '@/core/fill';
import { pickOption } from '@/core/setValue';
import { emptyProfile, type Profile } from '@/storage/schema';
import type { FieldReport } from '@/core/types';
import { mount } from './helpers';

function profileWith(patch: Partial<Profile>): Profile {
  return { ...emptyProfile(), ...patch };
}

async function fillPage(html: string, profile: Profile, overwrite = false) {
  mount(html);
  return fillFields(harvest(document), profile, { overwrite });
}

function report(reports: FieldReport[], needle: string): FieldReport {
  const match = reports.find((r) => r.label.toLowerCase().includes(needle.toLowerCase()));
  if (!match) throw new Error(`no report for "${needle}"`);
  return match;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('filling text controls', () => {
  it('fills matched fields and reports them', async () => {
    const result = await fillPage(
      `
        <form>
          <label for="a">First Name</label><input id="a" />
          <label for="b">Last Name</label><input id="b" />
          <label for="c">Email</label><input id="c" type="email" />
        </form>
      `,
      profileWith({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' }),
    );

    expect(result.filled).toBe(3);
    expect((document.getElementById('a') as HTMLInputElement).value).toBe('Ada');
    expect((document.getElementById('b') as HTMLInputElement).value).toBe('Lovelace');
    expect((document.getElementById('c') as HTMLInputElement).value).toBe('ada@example.com');
  });

  it('composes a full name from the two stored halves', async () => {
    await fillPage(
      `<label for="n">Full Name</label><input id="n" />`,
      profileWith({ firstName: 'Ada', lastName: 'Lovelace' }),
    );
    expect((document.getElementById('n') as HTMLInputElement).value).toBe('Ada Lovelace');
  });

  it('fires input and change so a framework sees the edit', async () => {
    mount(`<label for="a">Email</label><input id="a" />`);
    const input = document.getElementById('a') as HTMLInputElement;
    const seen: string[] = [];
    input.addEventListener('input', () => seen.push('input'));
    input.addEventListener('change', () => seen.push('change'));

    await fillFields(harvest(document), profileWith({ email: 'a@b.co' }), { overwrite: false });
    expect(seen).toEqual(['input', 'change']);
  });

  it('strips currency formatting for a number input', async () => {
    await fillPage(
      `<label for="s">Desired Salary</label><input id="s" type="number" />`,
      profileWith({ desiredSalary: '$150,000' }),
    );
    expect((document.getElementById('s') as HTMLInputElement).value).toBe('150000');
  });
});

describe('leaving things alone', () => {
  it('preserves a value the user already typed', async () => {
    mount(`<label for="a">First Name</label><input id="a" value="Grace" />`);
    const result = await fillFields(harvest(document), profileWith({ firstName: 'Ada' }), {
      overwrite: false,
    });

    expect((document.getElementById('a') as HTMLInputElement).value).toBe('Grace');
    expect(report(result.reports, 'First Name').status).toBe('preserved');
  });

  it('overwrites when explicitly asked to', async () => {
    mount(`<label for="a">First Name</label><input id="a" value="Grace" />`);
    await fillFields(harvest(document), profileWith({ firstName: 'Ada' }), { overwrite: true });
    expect((document.getElementById('a') as HTMLInputElement).value).toBe('Ada');
  });

  it('reports no-value when the profile is empty for a matched field', async () => {
    const result = await fillPage(
      `<label for="a">LinkedIn Profile</label><input id="a" />`,
      emptyProfile(),
    );
    expect(report(result.reports, 'LinkedIn').status).toBe('no-value');
  });

  it('never ticks a checkbox', async () => {
    const result = await fillPage(
      `<label for="a">I agree to the terms</label><input id="a" type="checkbox" />`,
      profileWith({ firstName: 'Ada' }),
    );
    expect((document.getElementById('a') as HTMLInputElement).checked).toBe(false);
    expect(report(result.reports, 'agree').status).toBe('unsupported');
  });

  it('leaves a résumé upload alone when no résumé is saved, and says why', async () => {
    const result = await fillPage(
      `<label for="a">Resume</label><input id="a" type="file" />`,
      profileWith({ resumeText: 'lots of text' }),
    );
    const upload = report(result.reports, 'Resume');
    expect(upload.status).toBe('no-value');
    expect(upload.reason).toMatch(/no résumé saved/i);
    expect((document.getElementById('a') as HTMLInputElement).files?.length ?? 0).toBe(0);
  });

  it('refuses a sensitive field even when it looks fillable', async () => {
    const result = await fillPage(
      `<label for="a">Social Security Number</label><input id="a" />`,
      profileWith({ firstName: 'Ada' }),
    );
    expect(report(result.reports, 'Social Security').status).toBe('unsupported');
    expect((document.getElementById('a') as HTMLInputElement).value).toBe('');
  });
});

describe('filling choice controls', () => {
  it('selects the option matching the stored value', async () => {
    await fillPage(
      `
        <label for="c">Country</label>
        <select id="c">
          <option value="">Select…</option>
          <option value="us">United States</option>
          <option value="ca">Canada</option>
        </select>
      `,
      profileWith({ country: 'Canada' }),
    );
    expect((document.getElementById('c') as HTMLSelectElement).value).toBe('ca');
  });

  it('checks the right radio in a group', async () => {
    await fillPage(
      `
        <fieldset>
          <legend>Are you legally authorized to work in the United States?</legend>
          <label><input type="radio" id="y" name="auth" value="Yes" /> Yes</label>
          <label><input type="radio" id="n" name="auth" value="No" /> No</label>
        </fieldset>
      `,
      profileWith({ workAuthorized: 'Yes' }),
    );
    expect((document.getElementById('y') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('n') as HTMLInputElement).checked).toBe(false);
  });

  it('answers authorization and sponsorship independently on the same form', async () => {
    await fillPage(
      `
        <form>
          <fieldset>
            <legend>Are you legally authorized to work in the United States?</legend>
            <label><input type="radio" id="auth-y" name="auth" value="Yes" /> Yes</label>
            <label><input type="radio" id="auth-n" name="auth" value="No" /> No</label>
          </fieldset>
          <fieldset>
            <legend>Will you now or in the future require visa sponsorship?</legend>
            <label><input type="radio" id="spon-y" name="spon" value="Yes" /> Yes</label>
            <label><input type="radio" id="spon-n" name="spon" value="No" /> No</label>
          </fieldset>
        </form>
      `,
      profileWith({ workAuthorized: 'Yes', requiresSponsorship: 'No' }),
    );

    expect((document.getElementById('auth-y') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('spon-n') as HTMLInputElement).checked).toBe(true);
  });

  it('reports a failure rather than picking a wrong option', async () => {
    const result = await fillPage(
      `
        <label for="c">Country</label>
        <select id="c"><option value="">Select…</option><option value="fr">France</option></select>
      `,
      profileWith({ country: 'Japan' }),
    );
    expect(report(result.reports, 'Country').status).toBe('failed');
    expect((document.getElementById('c') as HTMLSelectElement).value).toBe('');
  });
});

describe('pickOption', () => {
  const options = [
    { value: '', label: 'Select…' },
    { value: 'us', label: 'United States' },
    { value: 'umi', label: 'United States Minor Outlying Islands' },
    { value: 'ca', label: 'Canada' },
  ];

  it('prefers an exact label match over a longer prefix sibling', () => {
    expect(pickOption(options, 'United States')?.value).toBe('us');
  });

  it('refuses an ambiguous prefix', () => {
    expect(pickOption(options, 'United')).toBeNull();
  });

  it('never returns the blank placeholder', () => {
    expect(pickOption(options, '')).toBeNull();
  });

  it('maps yes/no synonyms onto the available wording', () => {
    const yesNo = [
      { value: '1', label: 'Y' },
      { value: '0', label: 'N' },
    ];
    expect(pickOption(yesNo, 'Yes')?.value).toBe('1');
    expect(pickOption(yesNo, 'No')?.value).toBe('0');
  });
});

describe('summary counts', () => {
  it('counts required fields still needing the user', async () => {
    const result = await fillPage(
      `
        <form>
          <label for="a">First Name</label><input id="a" required />
          <label for="b">Why do you want this job?</label><textarea id="b" required></textarea>
          <label for="c">Portfolio</label><input id="c" />
        </form>
      `,
      profileWith({ firstName: 'Ada' }),
    );

    expect(result.filled).toBe(1);
    expect(result.requiredUnfilled).toBe(1);
    expect(result.reports).toHaveLength(3);
  });
});
