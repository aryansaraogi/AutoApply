import { beforeEach, describe, expect, it } from 'vitest';
import { matchField } from '@/core/match';
import type { MatchOutcome } from '@/core/match';
import type { ValueKey } from '@/core/types';
import { harvestHtml } from './helpers';

beforeEach(() => {
  document.body.innerHTML = '';
});

/** Harvests a single-field fragment and matches it. */
function outcomeOf(html: string): MatchOutcome {
  const fields = harvestHtml(html);
  if (fields.length !== 1) {
    throw new Error(`fixture should yield exactly 1 field, got ${fields.length}`);
  }
  return matchField(fields[0]!);
}

function keyOf(html: string): ValueKey | null {
  const outcome = outcomeOf(html);
  return outcome.status === 'matched' ? outcome.result.key : null;
}

/** A labelled text input, the shape most of these cases take. */
function labelled(label: string, attrs = ''): string {
  return `<label for="x">${label}</label><input id="x" ${attrs} />`;
}

describe('standard fields', () => {
  const cases: [string, ValueKey][] = [
    ['First Name', 'firstName'],
    ['Given name *', 'firstName'],
    ['Last Name', 'lastName'],
    ['Surname', 'lastName'],
    ['Preferred Name', 'preferredName'],
    ['Full Name', 'fullName'],
    ['Email', 'email'],
    ['E-mail Address (Required)', 'email'],
    ['Phone', 'phone'],
    ['Mobile Number', 'phone'],
    ['Street Address', 'addressLine1'],
    ['Address Line 2', 'addressLine2'],
    ['City', 'city'],
    ['State / Province', 'state'],
    ['ZIP Code', 'postalCode'],
    ['Country', 'country'],
    ['LinkedIn Profile', 'linkedin'],
    ['GitHub URL', 'github'],
    ['Portfolio', 'portfolio'],
    ['Current Company', 'currentCompany'],
    ['Current Job Title', 'currentTitle'],
    ['Years of relevant experience', 'yearsExperience'],
    ['School', 'school'],
    ['Field of Study', 'fieldOfStudy'],
    ['Graduation Year', 'graduationYear'],
    ['Desired Salary', 'desiredSalary'],
    ['Notice Period', 'noticePeriod'],
    ['Earliest start date', 'earliestStartDate'],
    ['Pronouns', 'pronouns'],
    ['How did you hear about us?', 'howHeard'],
  ];

  for (const [label, key] of cases) {
    it(`maps "${label}" to ${key}`, () => {
      expect(keyOf(labelled(label))).toBe(key);
    });
  }
});

describe('adversarial labels stay unmatched or map elsewhere', () => {
  it('does not treat a previous employer as the current company', () => {
    expect(keyOf(labelled('Previous Employer'))).not.toBe('currentCompany');
  });

  it('does not treat "Why do you want to work at our company?" as a company name', () => {
    expect(keyOf(labelled('Why do you want to work at our company?'))).not.toBe('currentCompany');
  });

  it('does not treat "First day available" as a first name', () => {
    expect(keyOf(labelled('First day available'))).not.toBe('firstName');
  });

  it('does not treat "Phone extension" as the phone number', () => {
    expect(keyOf(labelled('Phone extension'))).not.toBe('phone');
  });

  it('does not treat "Country code" as the country', () => {
    expect(keyOf(labelled('Country code'))).not.toBe('country');
  });

  it('does not treat "Visa status" as the state field', () => {
    expect(keyOf(labelled('Visa status'))).not.toBe('state');
  });

  it('does not treat "Company website" as a personal portfolio', () => {
    expect(keyOf(labelled('Company website'))).not.toBe('portfolio');
  });

  it('does not treat "Desired job title" as the current title', () => {
    expect(keyOf(labelled('Desired job title'))).not.toBe('currentTitle');
  });

  it('does not treat "Current salary" as the desired salary', () => {
    expect(keyOf(labelled('Current salary'))).not.toBe('desiredSalary');
  });

  it('does not treat "Open source contributions" as a referral source', () => {
    expect(keyOf(labelled('Open source contributions'))).not.toBe('howHeard');
  });
});

describe('work authorization versus sponsorship', () => {
  it('maps the plain authorization question to workAuthorized', () => {
    expect(
      keyOf(labelled('Are you legally authorized to work in the United States?')),
    ).toBe('workAuthorized');
  });

  it('maps the plain sponsorship question to requiresSponsorship', () => {
    expect(
      keyOf(labelled('Will you now or in the future require visa sponsorship?')),
    ).toBe('requiresSponsorship');
  });

  it('never answers the authorization question with the sponsorship answer', () => {
    expect(keyOf(labelled('Do you require sponsorship for employment?'))).not.toBe(
      'workAuthorized',
    );
  });

  it('refuses the compound question that folds both together', () => {
    const outcome = outcomeOf(
      labelled('Are you legally authorized to work in the US without sponsorship?'),
    );
    expect(outcome.status).toBe('manual');
  });
});

describe('sensitive fields are blocked outright', () => {
  const blocked = [
    'Password',
    'Confirm Password',
    'Social Security Number',
    'Date of Birth',
    'Bank account number',
    'Credit card number',
    "Driver's License Number",
    'Passport number',
  ];

  for (const label of blocked) {
    it(`blocks "${label}"`, () => {
      expect(outcomeOf(labelled(label)).status).toBe('blocked');
    });
  }
});

describe('signal priority', () => {
  it('lets an autocomplete token beat a misleading label', () => {
    expect(keyOf(`<label for="x">Contact</label><input id="x" autocomplete="email" />`)).toBe(
      'email',
    );
  });

  it('uses the name attribute when there is no visible label', () => {
    expect(keyOf(`<input id="x" name="candidate[first_name]" />`)).toBe('firstName');
  });

  it('reports which signal produced the match', () => {
    const outcome = outcomeOf(`<input id="x" autocomplete="family-name" />`);
    expect(outcome.status === 'matched' && outcome.result.via).toBe('autocomplete');
  });
});

describe('radio groups match on their legend', () => {
  it('maps a veteran-status group', () => {
    const fields = harvestHtml(`
      <fieldset>
        <legend>Protected veteran status</legend>
        <label><input type="radio" name="v" value="a" /> I am not a protected veteran</label>
        <label><input type="radio" name="v" value="b" /> I identify as a protected veteran</label>
      </fieldset>
    `);
    const outcome = matchField(fields[0]!);
    expect(outcome.status === 'matched' && outcome.result.key).toBe('veteranStatus');
  });

  it('separates the hispanic/latino question from general race/ethnicity', () => {
    const fields = harvestHtml(`
      <fieldset>
        <legend>Are you Hispanic or Latino?</legend>
        <label><input type="radio" name="h" value="Yes" /> Yes</label>
        <label><input type="radio" name="h" value="No" /> No</label>
      </fieldset>
    `);
    const outcome = matchField(fields[0]!);
    expect(outcome.status === 'matched' && outcome.result.key).toBe('hispanicLatino');
  });
});

describe('unknown fields', () => {
  it('leaves a genuinely unrecognised question unmatched', () => {
    expect(outcomeOf(labelled('What is your favourite programming paradigm?')).status).toBe(
      'unmatched',
    );
  });

  it('leaves an unlabelled control unmatched rather than guessing', () => {
    expect(outcomeOf(`<div><input /></div>`).status).toBe('unmatched');
  });
});
