/**
 * Scores each rule against a harvested field and picks a winner — or refuses to.
 *
 * The refusal cases are the point. A wrong answer on a job application is worse
 * than a blank one, so anything the rules cannot separate confidently comes back
 * as `ambiguous` and is surfaced to the user instead of guessed at.
 */

import { normalizeAttribute } from './normalize';
import { BLOCKED_PATTERNS, MANUAL_REVIEW_PATTERNS, RULES, type MatchRule } from './rules';
import type { FieldDescriptor, MatchResult, ValueKey } from './types';

/** Below this, we treat the signal as noise. */
const SCORE_THRESHOLD = 40;

/** Two different keys within this many points of each other is a coin flip. */
const AMBIGUITY_MARGIN = 8;

const SCORE_AUTOCOMPLETE = 100;
const SCORE_LABEL = 60;
const SCORE_ATTRIBUTE = 40;

export type MatchOutcome =
  | { status: 'matched'; result: MatchResult }
  | { status: 'unmatched' }
  | { status: 'ambiguous'; between: [ValueKey, ValueKey] }
  | { status: 'blocked'; reason: string }
  | { status: 'manual'; reason: string };

export function matchField(field: FieldDescriptor): MatchOutcome {
  const label = field.normalizedLabel;
  const attrs = normalizeAttribute(`${field.name} ${field.domId}`);
  const haystack = `${label} ${attrs}`.trim();

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(haystack)) {
      return { status: 'blocked', reason: 'Sensitive field — AutoApply never fills this.' };
    }
  }

  for (const { pattern, reason } of MANUAL_REVIEW_PATTERNS) {
    if (pattern.test(label)) return { status: 'manual', reason };
  }

  const scored = RULES.map((rule) => scoreRule(rule, field, label, attrs)).filter(
    (candidate): candidate is MatchResult => candidate !== null,
  );

  if (scored.length === 0) return { status: 'unmatched' };

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0] as MatchResult;
  if (best.score < SCORE_THRESHOLD) return { status: 'unmatched' };

  const runnerUp = scored.find((candidate) => candidate.key !== best.key);
  if (runnerUp && best.score - runnerUp.score < AMBIGUITY_MARGIN) {
    return { status: 'ambiguous', between: [best.key, runnerUp.key] };
  }

  return { status: 'matched', result: best };
}

function scoreRule(
  rule: MatchRule,
  field: FieldDescriptor,
  label: string,
  attrs: string,
): MatchResult | null {
  if (rule.kinds && !rule.kinds.includes(field.kind)) return null;

  const haystack = `${label} ${attrs}`.trim();
  if (rule.exclude?.some((pattern) => pattern.test(haystack))) return null;

  const weight = rule.weight ?? 0;

  if (rule.autocomplete && matchesAutocomplete(field.autocomplete, rule.autocomplete)) {
    return { key: rule.key, score: SCORE_AUTOCOMPLETE + weight, via: 'autocomplete' };
  }
  if (label && rule.label?.some((pattern) => pattern.test(label))) {
    return { key: rule.key, score: SCORE_LABEL + weight, via: 'label' };
  }
  if (attrs && rule.attr?.some((pattern) => pattern.test(attrs))) {
    return { key: rule.key, score: SCORE_ATTRIBUTE + weight, via: 'attribute' };
  }
  return null;
}

/**
 * An autocomplete attribute can carry section and grouping tokens
 * ("section-primary shipping email"). Only the final token names the field.
 */
function matchesAutocomplete(attribute: string, tokens: readonly string[]): boolean {
  if (!attribute || attribute === 'off' || attribute === 'on') return false;
  const parts = attribute.split(/\s+/).filter(Boolean);
  const last = parts[parts.length - 1];
  return last !== undefined && tokens.includes(last);
}
