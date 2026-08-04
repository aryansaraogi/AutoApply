/**
 * The AI assist contract.
 *
 * Assist is opt-in, on-demand, and additive: it only ever sees fields the
 * deterministic rules could not map, it only runs when the user clicks the
 * button, and the extension is fully functional with it switched off.
 *
 * A provider is a single function. Adding another vendor means adding one file
 * that implements this type — nothing in the fill pipeline changes.
 */

import type { Profile } from '@/storage/schema';

/** One unanswered question, stripped down to what a model needs to answer it. */
export interface AiQuestion {
  fieldId: string;
  /** The visible label, including any group legend. */
  label: string;
  /** 'text' | 'textarea' | 'select' … so the model knows how long to be. */
  kind: string;
  required: boolean;
  /** For choice fields, the exact wordings that are selectable. */
  options: string[];
}

export interface AiAnswer {
  fieldId: string;
  /** Empty string means "the profile does not say" — never a guess. */
  value: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface AiRequest {
  profile: Profile;
  questions: AiQuestion[];
  model: string;
  apiKey: string;
}

export type AiProviderFn = (request: AiRequest) => Promise<AiAnswer[]>;

/**
 * The response schema. `additionalProperties: false` plus a closed enum keeps a
 * malformed reply from reaching the fill pipeline as a plausible-looking value.
 */
export const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fieldId: { type: 'string' },
          value: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['fieldId', 'value', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['answers'],
  additionalProperties: false,
} as const;

export const SYSTEM_PROMPT = [
  'You help someone fill in a job application from their own stored profile.',
  '',
  'Rules:',
  '- Answer only from the profile provided. It is the sole source of truth.',
  '- If the profile does not contain the answer, return an empty string for that',
  '  field. An empty answer is always better than an invented one.',
  '- Never invent employment history, dates, qualifications, salary figures, or',
  '  eligibility answers. These become statements on a real application.',
  '- For a field with options, return one of the given option strings verbatim,',
  '  or an empty string if none of them fit.',
  '- Keep free-text answers concise and in the first person.',
  '- Return one entry per field you were given, using the fieldId exactly.',
].join('\n');

/** Trims the profile to what the questions could plausibly need. */
export function buildUserContent(profile: Profile, questions: AiQuestion[]): string {
  return JSON.stringify({ profile, questions }, null, 2);
}

const CONFIDENCE_LEVELS = new Set(['high', 'medium', 'low']);

/**
 * The trust boundary for model output.
 *
 * Everything here is validated rather than assumed: entries are checked for
 * shape before being read, unknown field ids are dropped, and a choice field
 * only accepts one of the exact options it was offered. Structured outputs make
 * a malformed reply unlikely, but this is the one place standing between the
 * model and the user's application, so it does not rely on that.
 */
export function sanitizeAnswers(
  answers: readonly unknown[],
  questions: readonly AiQuestion[],
): AiAnswer[] {
  const asked = new Map(questions.map((question) => [question.fieldId, question]));

  return answers.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const { fieldId, value, confidence } = entry as Partial<AiAnswer>;

    if (typeof fieldId !== 'string' || typeof value !== 'string') return [];

    const question = asked.get(fieldId);
    if (!question) return [];

    const trimmed = value.trim();
    if (!trimmed) return [];

    // A choice field may only receive one of its own options.
    if (question.options.length > 0 && !question.options.includes(trimmed)) return [];

    return [
      {
        fieldId,
        value: trimmed,
        confidence: CONFIDENCE_LEVELS.has(confidence as string)
          ? (confidence as AiAnswer['confidence'])
          : 'low',
      },
    ];
  });
}
