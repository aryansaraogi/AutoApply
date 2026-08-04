import { describe, expect, it } from 'vitest';
import {
  asTernary,
  canonicalize,
  isBlank,
  normalizeAttribute,
  normalizeLabel,
  normalizeText,
  visibleTextOf,
} from '@/core/normalize';

describe('normalizeText', () => {
  it('lowercases and collapses punctuation to single spaces', () => {
    expect(normalizeText('  First   Name:  ')).toBe('first name');
    expect(normalizeText('E-mail/Address')).toBe('e mail address');
  });

  it('strips diacritics', () => {
    expect(normalizeText('Adresse électronique')).toBe('adresse electronique');
    expect(normalizeText('Müller')).toBe('muller');
  });

  it('keeps contractions as one word', () => {
    expect(normalizeText("What's your name")).toBe('whats your name');
    expect(normalizeText('What’s your name')).toBe('whats your name');
  });
});

describe('normalizeLabel', () => {
  it('drops trailing required and optional markers', () => {
    expect(normalizeLabel('First Name *')).toBe('first name');
    expect(normalizeLabel('First Name (Required)')).toBe('first name');
    expect(normalizeLabel('Middle Name (optional)')).toBe('middle name');
    expect(normalizeLabel('Phone required')).toBe('phone');
  });

  it('leaves the word "required" alone when it is not a trailing marker', () => {
    expect(normalizeLabel('Required skills for this role')).toBe(
      'required skills for this role',
    );
  });
});

describe('canonicalize', () => {
  it('folds spelling variants onto one form', () => {
    expect(canonicalize('E-mail Address')).toBe('email address');
    expect(canonicalize('Linked In Profile')).toBe('linkedin profile');
    expect(canonicalize('Surname')).toBe('last name');
    expect(canonicalize('Given Name')).toBe('first name');
    expect(canonicalize('Mobile Number')).toBe('phone number');
    expect(canonicalize('ZIP Code')).toBe('zip');
  });
});

describe('normalizeAttribute', () => {
  it('splits every attribute naming convention into words', () => {
    expect(normalizeAttribute('first_name')).toBe('first name');
    expect(normalizeAttribute('first-name')).toBe('first name');
    expect(normalizeAttribute('firstName')).toBe('first name');
    expect(normalizeAttribute('job_application[candidate][first_name]')).toBe(
      'job application candidate first name',
    );
  });
});

describe('visibleTextOf', () => {
  it('excludes text belonging to nested form controls', () => {
    document.body.innerHTML = `
      <label id="l">Country
        <select><option>United States</option><option>Canada</option></select>
      </label>`;
    expect(visibleTextOf(document.getElementById('l')!)).toBe('Country');
  });

  it('keeps plain markup around the text', () => {
    document.body.innerHTML = `<label id="l">Email <span class="req">*</span></label>`;
    expect(visibleTextOf(document.getElementById('l')!)).toBe('Email *');
  });
});

describe('asTernary', () => {
  it('maps affirmative and negative synonyms', () => {
    expect(asTernary('Yes')).toBe('yes');
    expect(asTernary('TRUE')).toBe('yes');
    expect(asTernary('N')).toBe('no');
    expect(asTernary('Maybe')).toBeNull();
  });
});

describe('isBlank', () => {
  it('treats punctuation-only and empty input as blank', () => {
    expect(isBlank('')).toBe(true);
    expect(isBlank(null)).toBe(true);
    expect(isBlank('  —  ')).toBe(true);
    expect(isBlank('a')).toBe(false);
  });
});
