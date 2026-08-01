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
 * OpenCode Zen adapter — OpenAI-compatible endpoint at `https://opencode.ai/zen/v1`.
 *
 * Free-tier models (verified live 2026-07-28): laguna-s-2.1-free (direct
 * answer, no hidden reasoning), north-mini-code-free / ling-3.0-flash-free /
 * nemotron-3-ultra-free / mimo-v2.5-free / deepseek-v4-flash-free (emit a
 * hidden `reasoning` field before `content` — only route these to tasks
 * with a generous `maxOutputTokens`, see router.ts comments).
 *
 * Token cost: $0 on free-tier models. Caller pays nothing.
 */

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      apiKey: env.OPENCODE_ZEN_API_KEY,
      baseURL: 'https://opencode.ai/zen/v1',
      // Free-tier models thỉnh thoảng treo không phản hồi. SDK mặc định
      // chờ 10 PHÚT + retry 2 lần → Aki "time out" với user thay vì
      // failover sang model kế tiếp trong chain. 20s là đủ cho cả model
      // có hidden reasoning; hết 20s thì ném lỗi để router rơi chain.
      timeout: 20_000,
      maxRetries: 0,
    });
  }
  return _client;
}

export const opencodeZenProvider: LlmProvider = {
  name: 'opencode-zen',

  isEnabled(): boolean {
    return env.OPENCODE_ZEN_API_KEY.length > 0;
  },

  async complete(input: CompletionInput): Promise<CompletionResult> {
    const client = getClient();
    const started = Date.now();

    try {
      // Vision: mimo-v2.5-free accepts OpenAI-style content parts. Only
      // build the array form when there's actually an image — some free
      // models reject the parts form for plain text.
      const userContent = input.imageUrl
        ? [
            { type: 'text' as const, text: input.userPrompt },
            { type: 'image_url' as const, image_url: { url: input.imageUrl } },
          ]
        : input.userPrompt;

      const createArgs = {
        model: input.model,
        messages: [
          { role: 'system' as const, content: input.systemPrompt },
          { role: 'user' as const, content: userContent },
        ],
        max_tokens: input.maxOutputTokens ?? 400,
        temperature: input.temperature ?? 0.7,
        ...(input.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
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
        provider: 'opencode-zen',
        model: input.model,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 429) {
        const headers = (err as { headers?: Record<string, string> })?.headers;
        const retryAfterStr = headers?.['retry-after'];
        const retryAfterMs = retryAfterStr ? Number.parseInt(retryAfterStr, 10) * 1000 : 30_000;
        throw new LlmRateLimitError(
          `opencode-zen 429: retry after ${retryAfterMs}ms`,
          Number.isNaN(retryAfterMs) ? 30_000 : retryAfterMs,
        );
      }
      throw new LlmProviderError(`opencode-zen: ${(err as Error)?.message ?? 'unknown'}`, err);
    }
  },
};
