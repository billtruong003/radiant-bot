import OpenAI from 'openai';
import type { ChatCompletion } from 'openai/resources/chat/completions';
import { env } from '../../../config/env.js';
import {
  type CompletionInput,
  type CompletionResult,
  type LlmProvider,
  LlmProviderError,
  LlmRateLimitError,
} from '../types.js';

/**
 * Groq adapter — OpenAI-compatible endpoint at `https://api.groq.com/openai/v1`.
 *
 * Free tier (as of 2026-05) per model:
 *   llama-3.1-8b-instant       : 30 RPM, 14.4K RPD, 6K TPM   (filter / nudge)
 *   llama-3.3-70b-versatile    : 30 RPM, 1K RPD,    12K TPM  (narration)
 *   qwen-3-32b                 : 60 RPM, 1K RPD,    6K TPM
 *
 * Token cost: $0 on free tier. Caller pays nothing.
 *
 * 429 handling: Groq returns `retry-after` header on 429. We throw
 * LlmRateLimitError with the parsed retry-after so the router can
 * throttle the right way.
 */

/**
 * Groq accepts `reasoning_format: 'hidden'` ONLY on reasoning models
 * (Qwen 3 family, gpt-oss family). Sending it to non-reasoning models
 * (Llama 3.x, Llama 4 Scout) returns HTTP 400 — observed in prod on
 * 2026-05-14 after we tried to send unconditionally.
 *
 * Pattern match instead of an exact list because Groq adds Qwen / gpt-oss
 * variants over time. Conservative — only known reasoning prefixes go in.
 */
export function modelSupportsReasoningFormat(model: string): boolean {
  const m = model.toLowerCase();
  return m.includes('qwen') || m.includes('gpt-oss');
}

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      apiKey: env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    });
  }
  return _client;
}

export const groqProvider: LlmProvider = {
  name: 'groq',

  isEnabled(): boolean {
    return env.GROQ_API_KEY.length > 0;
  },

  async complete(input: CompletionInput): Promise<CompletionResult> {
    const client = getClient();
    const started = Date.now();

    try {
      // Groq-specific: `reasoning_format: 'hidden'` suppresses the
      // `<think>…</think>` chain-of-thought trace that reasoning models
      // (Qwen 3 family, gpt-oss family) emit by default. Critically, this
      // parameter is REJECTED with HTTP 400 by non-reasoning models like
      // Llama 3.3 70B and Llama 4 Scout — observed in prod 2026-05-14.
      // Only send it for models that actually support it.
      const sendReasoningFormat = modelSupportsReasoningFormat(input.model);
      const createArgs = {
        model: input.model,
        messages: [
          { role: 'system' as const, content: input.systemPrompt },
          { role: 'user' as const, content: input.userPrompt },
        ],
        max_tokens: input.maxOutputTokens ?? 400,
        temperature: input.temperature ?? 0.7,
        ...(input.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
        ...(sendReasoningFormat ? { reasoning_format: 'hidden' } : {}),
      } as unknown as Parameters<typeof client.chat.completions.create>[0];
      const resp = (await client.chat.completions.create(createArgs)) as ChatCompletion;

      const text = resp.choices[0]?.message?.content?.trim() ?? '';
      const tokensIn = resp.usage?.prompt_tokens ?? 0;
      const tokensOut = resp.usage?.completion_tokens ?? 0;

      return {
        text,
        tokensIn,
        tokensOut,
        costUsd: 0,
        provider: 'groq',
        model: input.model,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      // openai SDK wraps HTTP errors in APIError with `status`.
      const status = (err as { status?: number })?.status;
      if (status === 429) {
        // Groq sends retry-after in seconds via headers; openai SDK
        // surfaces this on err.headers but not always — fall back to
        // a sensible default.
        const headers = (err as { headers?: Record<string, string> })?.headers;
        const retryAfterStr = headers?.['retry-after'];
        const retryAfterMs = retryAfterStr ? Number.parseInt(retryAfterStr, 10) * 1000 : 30_000;
        throw new LlmRateLimitError(
          `groq 429: retry after ${retryAfterMs}ms`,
          Number.isNaN(retryAfterMs) ? 30_000 : retryAfterMs,
        );
      }
      throw new LlmProviderError(`groq: ${(err as Error)?.message ?? 'unknown'}`, err);
    }
  },
};
