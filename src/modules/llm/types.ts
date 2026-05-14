/**
 * Provider-agnostic LLM interface for free/cheap text completion.
 *
 * Existing modules using this:
 *   - aki-filter   (classify /ask question)
 *   - aki-nudge    (Aki profanity reminder — coming Phase 11.2)
 *   - narration    (Thiên Đạo punishment + level-up prose — coming Phase 11.2)
 *
 * NOT in scope: xAI Grok (answer LLM for /ask) — its own client because
 * it has vision input + paid pricing + prompt caching. See
 * `src/modules/aki/client.ts`.
 *
 * Why a router + adapter pattern:
 *   - Single seam (`llm.complete(task, input)`) so features don't
 *     hardcode "use Gemini" or "use Groq".
 *   - Per-task model selection: filter uses fast 8B, narration uses
 *     prose-quality 70B.
 *   - Automatic failover: primary error / 429 → fallback provider.
 *   - Future-proof: drop in OpenRouter / Cerebras / etc by adding a
 *     `LlmProvider` impl, no caller changes.
 */

export type ProviderName = 'groq' | 'gemini';

/**
 * Logical tasks. Each maps to (primary provider+model, fallback +model)
 * in `router.ts`. Add a task here when introducing a new LLM feature.
 */
export type TaskId = 'aki-filter' | 'aki-nudge' | 'narration' | 'doc-validate' | 'divine-judgment';

export interface CompletionInput {
  systemPrompt: string;
  userPrompt: string;
  /** Provider-specific model id. Set by router from TASK_ROUTES. */
  model: string;
  maxOutputTokens?: number;
  /** 0.0 (deterministic) - 2.0. Default 0.7. */
  temperature?: number;
  /** When 'json', request strict JSON output (provider feature). */
  responseFormat?: 'text' | 'json';
}

export interface CompletionResult {
  /** Raw text or JSON string from the model. */
  text: string;
  tokensIn: number;
  tokensOut: number;
  /** USD cost. 0 for free-tier providers. */
  costUsd: number;
  provider: ProviderName;
  model: string;
  durationMs: number;
}

/**
 * Throw this when the provider is over capacity (HTTP 429). The router
 * catches it specifically and triggers a short throttle window so we
 * don't immediately retry on the same provider.
 */
export class LlmRateLimitError extends Error {
  readonly retryAfterMs?: number;
  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'LlmRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Throw for any non-rate-limit failure: network down, auth error,
 * malformed response, provider 500, etc. Router falls back without
 * throttling primary (the issue is transient or auth-config, not load).
 */
export class LlmProviderError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'LlmProviderError';
    this.cause = cause;
  }
}

export interface LlmProvider {
  readonly name: ProviderName;
  /** True if API key + config are present. False = skip in router. */
  isEnabled(): boolean;
  /** Throws LlmRateLimitError on 429, LlmProviderError otherwise. */
  complete(input: CompletionInput): Promise<CompletionResult>;
}
