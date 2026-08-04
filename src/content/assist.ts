/**
 * On-demand AI assist, page side.
 *
 * Only questions the deterministic rules could not map are sent, and only after
 * the user clicks the button in the review overlay. The API key never reaches
 * this context — the service worker makes the call and returns answers.
 */

import type { AiQuestion } from '@/ai/provider';
import { sendToBackground, type AiAnswerResponse } from '@/core/messages';
import { applyValue } from '@/core/setValue';
import type { FieldDescriptor, FieldReport } from '@/core/types';

/** Statuses worth asking about: a real question we simply had no rule for. */
const ASKABLE = new Set<FieldReport['status']>(['unmatched', 'ambiguous']);

/**
 * A field the user must answer personally is never sent, whatever its status.
 * `unsupported` already covers passwords, consent boxes, uploads and the
 * compound eligibility questions — none of which an assistant should touch.
 */
export function questionsFor(
  reports: readonly FieldReport[],
  fields: ReadonlyMap<string, FieldDescriptor>,
): AiQuestion[] {
  return reports.flatMap((report) => {
    if (!ASKABLE.has(report.status)) return [];

    const field = fields.get(report.fieldId);
    if (!field || !field.label) return [];

    return [
      {
        fieldId: report.fieldId,
        label: field.legend && field.legend !== field.label
          ? `${field.legend} — ${field.label}`
          : field.label,
        kind: field.kind,
        required: field.required,
        options: field.options.map((option) => option.label).filter(Boolean),
      },
    ];
  });
}

export interface AssistResult {
  reports: FieldReport[];
  filled: number;
  error?: string;
}

/**
 * Asks the service worker for answers and writes the accepted ones into the
 * page. Returns updated reports so the overlay can re-render with the AI-sourced
 * fields marked.
 */
export async function runAssist(
  reports: readonly FieldReport[],
  fields: ReadonlyMap<string, FieldDescriptor>,
): Promise<AssistResult> {
  const questions = questionsFor(reports, fields);
  if (questions.length === 0) return { reports: [...reports], filled: 0 };

  const response = await sendToBackground<AiAnswerResponse>({ type: 'AI_ANSWER', questions });

  if (!response) {
    return { reports: [...reports], filled: 0, error: 'The background worker did not respond.' };
  }
  if (!response.ok) {
    return { reports: [...reports], filled: 0, error: response.error };
  }

  const updated = new Map(reports.map((report) => [report.fieldId, { ...report }]));
  let filled = 0;

  for (const answer of response.answers) {
    const field = fields.get(answer.fieldId);
    const report = updated.get(answer.fieldId);
    if (!field || !report) continue;

    const applied = await applyValue(field, answer.value);
    if (applied.ok) {
      Object.assign(report, {
        status: 'filled' as const,
        value: answer.value,
        source: 'ai' as const,
        reason: undefined,
      });
      filled++;
    } else {
      report.reason = applied.reason ?? report.reason;
    }
  }

  return { reports: [...updated.values()], filled };
}
