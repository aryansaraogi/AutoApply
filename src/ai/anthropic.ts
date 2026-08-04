/**
 * Claude-backed AI assist.
 *
 * Runs in the service worker, never in the page: the key must not be reachable
 * from a content script's context, and the SW is the only place with the host
 * permission for api.anthropic.com. `dangerouslyAllowBrowser` is required
 * because the SDK refuses non-Node environments by default — here the flag is
 * appropriate rather than dangerous, since the "browser" is the extension's own
 * background worker and the key belongs to the user running it.
 */

import Anthropic from '@anthropic-ai/sdk';

import {
  ANSWER_SCHEMA,
  SYSTEM_PROMPT,
  buildUserContent,
  sanitizeAnswers,
  type AiProviderFn,
} from './provider';

const MAX_TOKENS = 4096;

export const anthropicProvider: AiProviderFn = async ({ profile, questions, model, apiKey }) => {
  if (questions.length === 0) return [];

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const response = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserContent(profile, questions) }],
    // Constrains the reply to the schema, so a parse failure is a bug rather
    // than an expected case we would have to guess our way through.
    output_config: { format: { type: 'json_schema', schema: ANSWER_SCHEMA } },
  });

  // A refusal is a normal 200 response, not an exception — check before reading.
  if (response.stop_reason === 'refusal') {
    throw new Error('Claude declined to answer these questions.');
  }

  const text = response.content.find((block) => block.type === 'text');
  if (!text || text.type !== 'text') {
    throw new Error('Claude returned no answers.');
  }

  return sanitizeAnswers(parseAnswers(text.text), questions);
};

function parseAnswers(raw: string): unknown[] {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') return [];
  const answers = (parsed as { answers?: unknown }).answers;
  return Array.isArray(answers) ? answers : [];
}
