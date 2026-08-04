/**
 * AI assist boundaries.
 *
 * Two gates matter here, and both are safety rather than accuracy: what is
 * allowed to leave the page, and what is allowed back in. Passwords, consent
 * boxes and the compound eligibility questions must never be sent; a model
 * reply naming a field we never asked about, or an option that does not exist,
 * must never reach the form.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { questionsFor } from '@/content/assist';
import { sanitizeAnswers, type AiAnswer, type AiQuestion } from '@/ai/provider';
import { fillFields } from '@/core/fill';
import { harvest } from '@/core/harvest';
import type { FieldDescriptor, FieldReport } from '@/core/types';
import { emptyProfile } from '@/storage/schema';
import { mount } from './helpers';

async function analyse(html: string): Promise<{
  reports: FieldReport[];
  fields: Map<string, FieldDescriptor>;
}> {
  mount(html);
  const fields = harvest(document);
  const result = await fillFields(fields, emptyProfile(), { overwrite: false });
  return { reports: result.reports, fields: new Map(fields.map((f) => [f.id, f])) };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('what gets sent to the model', () => {
  it('asks about a genuine question the rules could not map', async () => {
    const { reports, fields } = await analyse(
      `<label for="q">What is your favourite deployment strategy?</label><textarea id="q"></textarea>`,
    );
    const questions = questionsFor(reports, fields);
    expect(questions).toHaveLength(1);
    expect(questions[0]?.label).toBe('What is your favourite deployment strategy?');
  });

  it('never sends a sensitive field', async () => {
    const { reports, fields } = await analyse(
      `<label for="p">Social Security Number</label><input id="p" />`,
    );
    expect(questionsFor(reports, fields)).toHaveLength(0);
  });

  it('never sends a consent checkbox', async () => {
    const { reports, fields } = await analyse(
      `<label for="c">I agree to the terms</label><input id="c" type="checkbox" />`,
    );
    expect(questionsFor(reports, fields)).toHaveLength(0);
  });

  it('never sends a file upload', async () => {
    const { reports, fields } = await analyse(
      `<label for="r">Resume</label><input id="r" type="file" />`,
    );
    expect(questionsFor(reports, fields)).toHaveLength(0);
  });

  it('never sends the compound work-authorization question', async () => {
    const { reports, fields } = await analyse(
      `<label for="a">Are you legally authorized to work in the US without sponsorship?</label>
       <input id="a" />`,
    );
    expect(questionsFor(reports, fields)).toHaveLength(0);
  });

  it('does not re-ask about a field the rules already answered', async () => {
    mount(`<label for="e">Email</label><input id="e" />`);
    const fields = harvest(document);
    const result = await fillFields(
      fields,
      { ...emptyProfile(), email: 'ada@example.com' },
      { overwrite: false },
    );
    const map = new Map(fields.map((f) => [f.id, f]));
    expect(questionsFor(result.reports, map)).toHaveLength(0);
  });

  it('does not ask about a field whose only problem is an empty profile', async () => {
    // The rules matched it; the profile just has nothing. A model cannot invent
    // the user's LinkedIn URL, so asking would only invite a fabrication.
    const { reports, fields } = await analyse(
      `<label for="l">LinkedIn Profile</label><input id="l" />`,
    );
    expect(questionsFor(reports, fields)).toHaveLength(0);
  });

  it('passes the available options along for a choice field', async () => {
    const { reports, fields } = await analyse(`
      <label for="s">Which team interests you most?</label>
      <select id="s"><option value="">Pick…</option><option>Platform</option><option>Growth</option></select>
    `);
    expect(questionsFor(reports, fields)[0]?.options).toEqual(['Pick…', 'Platform', 'Growth']);
  });
});

describe('what gets accepted back', () => {
  const questions: AiQuestion[] = [
    { fieldId: 'f1', label: 'Why this role?', kind: 'textarea', required: true, options: [] },
    {
      fieldId: 'f2',
      label: 'Preferred team',
      kind: 'select',
      required: false,
      options: ['Platform', 'Growth'],
    },
  ];

  const answer = (patch: Partial<AiAnswer>): AiAnswer => ({
    fieldId: 'f1',
    value: 'Because I like platforms.',
    confidence: 'high',
    ...patch,
  });

  it('accepts a well-formed free-text answer', () => {
    expect(sanitizeAnswers([answer({})], questions)).toHaveLength(1);
  });

  it('drops an answer for a field that was never asked about', () => {
    expect(sanitizeAnswers([answer({ fieldId: 'f9' })], questions)).toHaveLength(0);
  });

  it('drops an empty answer rather than blanking the field', () => {
    expect(sanitizeAnswers([answer({ value: '   ' })], questions)).toHaveLength(0);
  });

  it('drops a choice answer that is not one of the offered options', () => {
    const rogue = answer({ fieldId: 'f2', value: 'Infrastructure' });
    expect(sanitizeAnswers([rogue], questions)).toHaveLength(0);
  });

  it('accepts a choice answer that matches an option verbatim', () => {
    const valid = answer({ fieldId: 'f2', value: 'Growth' });
    expect(sanitizeAnswers([valid], questions)).toEqual([
      { fieldId: 'f2', value: 'Growth', confidence: 'high' },
    ]);
  });

  it('survives a malformed reply without throwing', () => {
    const junk = [{ fieldId: 'f1' }, null, 42] as unknown as AiAnswer[];
    expect(() => sanitizeAnswers(junk, questions)).not.toThrow();
    expect(sanitizeAnswers(junk, questions)).toHaveLength(0);
  });
});
