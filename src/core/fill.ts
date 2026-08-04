/**
 * The fill pipeline: decide, apply, and report — one field at a time.
 *
 * Every field produces a FieldReport whatever happens to it, including the ones
 * we deliberately leave alone. That record is what the review overlay renders,
 * so "why is this still empty?" always has an answer on screen.
 */

import type { Profile } from '@/storage/schema';
import { attachFile, classifyFileField, type ResumePayload } from './attach';
import { matchField } from './match';
import { resolveValue } from './rules';
import { applyValue, type ApplyOutcome } from './setValue';
import type { FieldDescriptor, FieldReport, FillOptions } from './types';

export interface FillPassResult {
  reports: FieldReport[];
  filled: number;
  skipped: number;
  /** Required fields still without a value — the ones the user must handle. */
  requiredUnfilled: number;
}

/**
 * Lets a site adapter take over a control the generic code cannot drive (a
 * react-select menu, a Workday picker). Returning null means "not mine".
 */
export type FillOverride = (
  field: FieldDescriptor,
  value: string,
) => Promise<ApplyOutcome | null>;

export async function fillFields(
  fields: readonly FieldDescriptor[],
  profile: Profile,
  options: FillOptions,
  override?: FillOverride,
  /** The résumé to attach to résumé uploads. Omitted means uploads are skipped. */
  resume?: ResumePayload | null,
): Promise<FillPassResult> {
  const reports: FieldReport[] = [];

  for (const field of fields) {
    reports.push(await fillOne(field, profile, options, override, resume));
    // Yield between fields so a page that repopulates one control in response to
    // another (country → state) has rendered before we look at the next field.
    await settle();
  }

  const filled = reports.filter((r) => r.status === 'filled').length;
  const requiredUnfilled = reports.filter(
    (r) => r.required && r.status !== 'filled' && r.status !== 'preserved',
  ).length;

  return { reports, filled, skipped: reports.length - filled, requiredUnfilled };
}

async function fillOne(
  field: FieldDescriptor,
  profile: Profile,
  options: FillOptions,
  override?: FillOverride,
  resume?: ResumePayload | null,
): Promise<FieldReport> {
  const base = {
    fieldId: field.id,
    label: field.label,
    kind: field.kind,
    required: field.required,
  };

  if (field.kind === 'file') return fillFileField(field, base, resume);

  if (field.kind === 'checkbox') {
    return {
      ...base,
      status: 'unsupported',
      reason: 'Consent and acknowledgement boxes are yours to tick.',
    };
  }

  const outcome = matchField(field);
  switch (outcome.status) {
    case 'blocked':
      return { ...base, status: 'unsupported', reason: outcome.reason };
    case 'manual':
      return { ...base, status: 'unsupported', reason: outcome.reason };
    case 'unmatched':
      return { ...base, status: 'unmatched', reason: 'No profile field matches this question.' };
    case 'ambiguous':
      return {
        ...base,
        status: 'ambiguous',
        reason: `Could be ${outcome.between[0]} or ${outcome.between[1]} — too close to call.`,
      };
    case 'matched':
      break;
  }

  const key = outcome.result.key;
  const value = resolveValue(profile, key).trim();

  if (!value) {
    return {
      ...base,
      status: 'no-value',
      key,
      reason: `Your profile has no "${key}" yet.`,
    };
  }

  if (field.hasValue && !options.overwrite) {
    return {
      ...base,
      status: 'preserved',
      key,
      reason: 'Already filled in — left as it was.',
    };
  }

  const applied = (await override?.(field, value)) ?? (await applyValue(field, value));

  return applied.ok
    ? { ...base, status: 'filled', key, value, source: 'rules' }
    : { ...base, status: 'failed', key, value, reason: applied.reason };
}

/** Fields carried into every report, whatever the outcome. */
type ReportBase = Pick<FieldReport, 'fieldId' | 'label' | 'kind' | 'required'>;

/**
 * File uploads. Only a résumé field is ever attached to — a transcript, a
 * portfolio, or an ambiguous "resume and cover letter" box is left for the user,
 * since pushing the wrong document at an employer is worse than an empty field.
 */
function fillFileField(
  field: FieldDescriptor,
  base: ReportBase,
  resume?: ResumePayload | null,
): FieldReport {
  const kind = classifyFileField(field);

  if (kind === 'cover-letter') {
    return { ...base, status: 'unsupported', reason: 'Attach your cover letter yourself.' };
  }
  if (kind === 'other') {
    return {
      ...base,
      status: 'unsupported',
      reason: 'AutoApply only attaches résumés — add this file yourself.',
    };
  }
  if (!resume) {
    return {
      ...base,
      status: 'no-value',
      reason: 'No résumé saved yet. Add one on the profile page to attach it automatically.',
    };
  }

  const attached = attachFile(field, resume);
  return attached.ok
    ? { ...base, status: 'filled', value: resume.filename, source: 'resume' }
    : { ...base, status: 'failed', value: resume.filename, reason: attached.reason };
}

/** Upper bound on the wait for a frame, in ms. */
const SETTLE_TIMEOUT_MS = 100;

/**
 * Waits for the page to render between fields.
 *
 * A rendered frame is the signal we actually want — it means a control that
 * repopulates in response to another (country → state) has caught up. But
 * requestAnimationFrame does not fire at all in a background, occluded, or
 * minimised tab, so waiting on it alone stalls the whole fill indefinitely.
 * The timer is the floor that guarantees progress; rAF wins whenever the page
 * is actually being painted.
 */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(finish);
    setTimeout(finish, SETTLE_TIMEOUT_MS);
  });
}
