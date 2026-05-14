import { env } from '../../../config/env.js';
import {
  type CompletionInput,
  type CompletionResult,
  type LlmProvider,
  LlmProviderError,
  LlmRateLimitError,
} from '../types.js';

/**
 * Gemini REST adapter. Uses fetch directly — no SDK — because Gemini's
 * Python/Node SDKs are heavier than needed for a single completion call.
 *
 * Free tier limits (per Google Cloud, 2026-05):
 *   gemini-2.0-flash : 15 RPM, 1500 RPD, 1M TPM
 *
 * Pricing (paid): $0.075 / 1M input, $0.30 / 1M output.
 * Free tier reports the same usage metadata so costUsd is computed from
 * tokens regardless — caller can sum across providers.
 *
 * Was previously in `src/modules/aki/filter.ts`. Moved here as part of
 * Phase 11 LLM provider abstraction. Filter persona stays in its own
 * file; this is pure transport.
 */

const PRICING = {
  inputPer1M: 0.075,
  outputPer1M: 0.3,
} as const;

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

function computeCost(tokensIn: number, tokensOut: number): number {
  return (tokensIn * PRICING.inputPer1M + tokensOut * PRICING.outputPer1M) / 1_000_000;
}

export const geminiProvider: LlmProvider = {
  name: 'gemini',

  isEnabled(): boolean {
    return env.GEMINI_API_KEY.length > 0;
  },

  async complete(input: CompletionInput): Promise<CompletionResult> {
    const started = Date.now();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      input.model,
    )}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

    const body = {
      systemInstruction: { parts: [{ text: input.systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: input.userPrompt }] }],
      generationConfig: {
        temperature: input.temperature ?? 0.7,
        maxOutputTokens: input.maxOutputTokens ?? 400,
        ...(input.responseFormat === 'json' ? { responseMimeType: 'application/json' } : {}),
      },
      safetySettings: [
        // Relax for Aki sass / mean filter rejections — we self-censor
        // in the persona prompt itself.
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
      ],
    };

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new LlmProviderError('gemini: network error', err);
    }

    if (resp.status === 429) {
      const retryAfterStr = resp.headers.get('retry-after');
      const retryAfterMs = retryAfterStr ? Number.parseInt(retryAfterStr, 10) * 1000 : 30_000;
      throw new LlmRateLimitError(
        `gemini 429: retry after ${retryAfterMs}ms`,
        Number.isNaN(retryAfterMs) ? 30_000 : retryAfterMs,
      );
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new LlmProviderError(`gemini: HTTP ${resp.status} — ${text.slice(0, 200)}`);
    }

    let json: GeminiResponse;
    try {
      json = (await resp.json()) as GeminiResponse;
    } catch (err) {
      throw new LlmProviderError('gemini: response not JSON', err);
    }

    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const tokensIn = json.usageMetadata?.promptTokenCount ?? 0;
    const tokensOut = json.usageMetadata?.candidatesTokenCount ?? 0;

    return {
      text: text.trim(),
      tokensIn,
      tokensOut,
      costUsd: computeCost(tokensIn, tokensOut),
      provider: 'gemini',
      model: input.model,
      durationMs: Date.now() - started,
    };
  },
};
