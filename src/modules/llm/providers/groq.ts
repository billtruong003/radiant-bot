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
      // `<think>…</think>` chain-of-thought trace that Qwen 3 32B (and
      // gpt-oss-120b) emit by default in `raw` mode. Without this,
      // reasoning leaks into output and broke prod narration / filter
      // JSON parsing on 2026-05-14. Non-reasoning models (Llama 3.x, 4)
      // silently ignore this field, so it's safe to send unconditionally.
      // `reasoning_format` is a Groq-only extension not in the OpenAI
      // typedef. Cast to a wider record to slip it past the type-checker.
      const createArgs = {
        model: input.model,
        messages: [
          { role: 'system' as const, content: input.systemPrompt },
          { role: 'user' as const, content: input.userPrompt },
        ],
        max_tokens: input.maxOutputTokens ?? 400,
        temperature: input.temperature ?? 0.7,
        ...(input.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
        reasoning_format: 'hidden',
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
