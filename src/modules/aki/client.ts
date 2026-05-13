import OpenAI from 'openai';
import { ulid } from 'ulid';
import { env } from '../../config/env.js';
import { getStore } from '../../db/index.js';
import { logger } from '../../utils/logger.js';
import { AKI_SYSTEM_PROMPT } from './persona.js';

/**
 * xAI Grok client wrapper for Aki. Uses the OpenAI Node SDK pointed at
 * the xAI compat endpoint — no separate xAI SDK needed.
 *
 * Pricing (per 1M tokens, grok-4-1-fast-reasoning):
 *   - input uncached : $0.20
 *   - input cached   : $0.05  (auto via prompt caching)
 *   - output         : $0.50
 *
 * Caller is responsible for rate-limit + budget gating BEFORE calling
 * askAki. This function persists an AkiCallLog with cost + token
 * breakdown for budget tracking in subsequent calls.
 */

const PRICING = {
  inputUncachedPer1M: 0.2,
  inputCachedPer1M: 0.05,
  outputPer1M: 0.5,
} as const;

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    if (!env.XAI_API_KEY) {
      throw new Error('XAI_API_KEY not set — Aki disabled');
    }
    _client = new OpenAI({
      apiKey: env.XAI_API_KEY,
      baseURL: 'https://api.x.ai/v1',
    });
  }
  return _client;
}

export interface AskAkiInput {
  discordId: string;
  question: string;
  /** Discord attachment URL (image/jpeg, image/png, image/webp). */
  imageUrl?: string;
}

export interface AkiResponse {
  reply: string;
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  costUsd: number;
}

/**
 * Compute USD cost from token usage. Pure — exported for tests + budget
 * calculations that need to estimate cost without making a call.
 */
export function computeCost(
  promptTokens: number,
  cachedTokens: number,
  completionTokens: number,
): number {
  const uncached = Math.max(0, promptTokens - cachedTokens);
  return (
    (uncached * PRICING.inputUncachedPer1M +
      cachedTokens * PRICING.inputCachedPer1M +
      completionTokens * PRICING.outputPer1M) /
    1_000_000
  );
}

export function isAkiEnabled(): boolean {
  return env.XAI_API_KEY.length > 0;
}

/**
 * Call Grok with Aki persona. Persists an AkiCallLog on success or
 * refusal. Throws only on network / SDK errors — callers should
 * handle with try/catch and fall back to a generic error reply.
 */
export async function askAki(input: AskAkiInput): Promise<AkiResponse> {
  const client = getClient();

  const userContent: OpenAI.ChatCompletionContentPart[] = [{ type: 'text', text: input.question }];
  if (input.imageUrl) {
    userContent.push({ type: 'image_url', image_url: { url: input.imageUrl } });
  }

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: AKI_SYSTEM_PROMPT },
    { role: 'user', content: input.imageUrl ? userContent : input.question },
  ];

  const resp = await client.chat.completions.create({
    model: env.AKI_MODEL,
    messages,
    max_tokens: env.AKI_MAX_OUTPUT_TOKENS,
    temperature: 0.8,
  });

  const usage = resp.usage;
  const tokensIn = usage?.prompt_tokens ?? 0;
  const tokensOut = usage?.completion_tokens ?? 0;
  // xAI returns cached count under prompt_tokens_details.cached_tokens
  // (OpenAI-compatible). May be absent on early misses.
  const cachedTokens =
    (usage as { prompt_tokens_details?: { cached_tokens?: number } } | undefined)
      ?.prompt_tokens_details?.cached_tokens ?? 0;
  const costUsd = computeCost(tokensIn, cachedTokens, tokensOut);

  const reply = resp.choices[0]?.message?.content?.trim() ?? '';

  await getStore().akiLogs.append({
    id: ulid(),
    discord_id: input.discordId,
    question_length: input.question.length,
    has_image: !!input.imageUrl,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    cached_tokens: cachedTokens,
    cost_usd: costUsd,
    refusal: false,
    refusal_reason: null,
    created_at: Date.now(),
  });

  logger.info(
    {
      discord_id: input.discordId,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cached: cachedTokens,
      cost_usd: costUsd.toFixed(6),
      has_image: !!input.imageUrl,
    },
    'aki: call completed',
  );

  return { reply, tokensIn, tokensOut, cachedTokens, costUsd };
}

/**
 * Persist a refusal (rate-limit or budget) without making an API call.
 * Lets analytics show how much demand was capped vs. served.
 */
export async function logRefusal(
  discordId: string,
  questionLength: number,
  reason: string,
): Promise<void> {
  await getStore().akiLogs.append({
    id: ulid(),
    discord_id: discordId,
    question_length: questionLength,
    has_image: false,
    tokens_in: 0,
    tokens_out: 0,
    cached_tokens: 0,
    cost_usd: 0,
    refusal: true,
    refusal_reason: reason,
    created_at: Date.now(),
  });
}
