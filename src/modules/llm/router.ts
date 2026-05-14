import { logger } from '../../utils/logger.js';
import { geminiProvider } from './providers/gemini.js';
import { groqProvider } from './providers/groq.js';
import {
  type CompletionResult,
  type LlmProvider,
  LlmProviderError,
  LlmRateLimitError,
  type ProviderName,
  type TaskId,
} from './types.js';

/**
 * Per-task routing table + provider failover.
 *
 * Each TaskId maps to an ordered `Route[]` chain. The router tries
 * entries left-to-right, skipping any (provider, model) pair currently
 * throttled (429 cooldown active) or whose provider is disabled
 * (missing API key). The first successful response wins.
 *
 * Throttle bookkeeping is per-(provider, model) pair — not per-provider —
 * so when Gemini 2.5 Flash hits 429 we can still try Gemini 3.1 Flash
 * Lite on the same API key. Each Gemini model has its own free-tier
 * RPM/RPD quota: rotating across them multiplies effective headroom.
 *
 * Failover policy (per Bill's call):
 *   - LlmRateLimitError → throttle THAT (provider, model) for retryAfterMs,
 *     then try next route.
 *   - LlmProviderError  → try next route without throttling (transient).
 *   - All routes exhausted → return null. Caller applies task-specific
 *     degradation (filter = fail-open, narration = static fallback, etc).
 */

interface Route {
  provider: ProviderName;
  model: string;
}

const TASK_ROUTES: Record<TaskId, readonly Route[]> = {
  // FILTER — classification + VN sass. Live test (2026-05-14): Llama 3.1
  // 8B misclassified "Aki ở đâu?" as trash → incoherent improvisation.
  // 2026 best picks for VN classification on Groq free tier:
  //   - Qwen 3 32B (Alibaba) — strongest multilingual for Asian langs,
  //     60 RPM / 1K RPD — best primary
  //   - Llama 3.3 70B Versatile — solid backup quality
  //   - Llama 4 Scout 17B-16E (MoE) — newer arch, 30K TPM
  //   - Llama 3.1 8B Instant — fast path (14.4K RPD) when above exhausted
  // Then Gemini chain. Gemini 2.0 Flash dropped — superseded by 2.5/3.x.
  'aki-filter': [
    { provider: 'groq', model: 'qwen/qwen3-32b' },
    { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    { provider: 'groq', model: 'meta-llama/llama-4-scout-17b-16e-instruct' },
    { provider: 'groq', model: 'llama-3.1-8b-instant' },
    { provider: 'gemini', model: 'gemini-2.5-flash' },
    { provider: 'gemini', model: 'gemini-3.1-flash-lite' },
    { provider: 'gemini', model: 'gemini-2.5-flash-lite' },
  ],
  // NUDGE — short "kiềm chế lời" reminders. 8B is fine (no classification),
  // Llama 4 Scout as quality bump if 8B throttled.
  'aki-nudge': [
    { provider: 'groq', model: 'llama-3.1-8b-instant' },
    { provider: 'groq', model: 'meta-llama/llama-4-scout-17b-16e-instruct' },
    { provider: 'gemini', model: 'gemini-2.5-flash-lite' },
  ],
  // NARRATION — cultivation-themed prose. Qwen 3 first because Alibaba
  // trained heavily on Chinese xianxia + VN; gpt-oss-120b biggest for
  // heavy lifting; Llama 4 Scout newer arch.
  narration: [
    { provider: 'groq', model: 'qwen/qwen3-32b' },
    { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    { provider: 'groq', model: 'openai/gpt-oss-120b' },
    { provider: 'groq', model: 'meta-llama/llama-4-scout-17b-16e-instruct' },
    { provider: 'gemini', model: 'gemini-2.5-flash' },
    { provider: 'gemini', model: 'gemini-3.1-flash-lite' },
    { provider: 'gemini', model: 'gemini-2.5-flash-lite' },
  ],
};

const PROVIDERS: Record<ProviderName, LlmProvider> = {
  groq: groqProvider,
  gemini: geminiProvider,
};

/**
 * Throttle map keyed by `${provider}:${model}` so each model has its
 * own cooldown window. Value = epoch ms when usable again.
 */
const throttledUntil: Map<string, number> = new Map();

function routeKey(route: Route): string {
  return `${route.provider}:${route.model}`;
}

function isThrottled(route: Route, now: number): boolean {
  const until = throttledUntil.get(routeKey(route));
  return until !== undefined && now < until;
}

function throttleFor(route: Route, ms: number, now: number): void {
  throttledUntil.set(routeKey(route), now + ms);
}

export interface RouterInput {
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens?: number;
  temperature?: number;
  responseFormat?: 'text' | 'json';
}

export interface RouterResult extends CompletionResult {
  /** 0 = primary, 1 = first fallback, etc. Useful for logs / analytics. */
  routeIndex: number;
}

async function tryRoute(
  route: Route,
  input: RouterInput,
  now: number,
): Promise<CompletionResult | null> {
  const provider = PROVIDERS[route.provider];
  if (!provider.isEnabled()) return null;
  if (isThrottled(route, now)) return null;

  try {
    return await provider.complete({
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      model: route.model,
      maxOutputTokens: input.maxOutputTokens,
      temperature: input.temperature,
      responseFormat: input.responseFormat,
    });
  } catch (err) {
    if (err instanceof LlmRateLimitError) {
      throttleFor(route, err.retryAfterMs ?? 30_000, now);
      logger.warn(
        {
          provider: route.provider,
          model: route.model,
          retryAfterMs: err.retryAfterMs,
        },
        'llm: route throttled (will skip until cooldown expires)',
      );
      return null;
    }
    if (err instanceof LlmProviderError) {
      logger.warn(
        { provider: route.provider, model: route.model, err: err.message },
        'llm: route errored, trying next',
      );
      return null;
    }
    throw err;
  }
}

/**
 * Run a completion through the configured chain for `task`. Returns null
 * if every route is unavailable (disabled, throttled, or errored) so
 * the caller can apply task-specific degradation.
 */
export async function complete(task: TaskId, input: RouterInput): Promise<RouterResult | null> {
  const routes = TASK_ROUTES[task];
  const now = Date.now();

  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    if (!route) continue;
    const result = await tryRoute(route, input, now);
    if (result) {
      if (i > 0) {
        logger.info(
          { task, routeIndex: i, provider: route.provider, model: route.model },
          'llm: routed to fallback',
        );
      }
      return { ...result, routeIndex: i };
    }
  }

  logger.error(
    { task, totalRoutes: routes.length },
    'llm: no route succeeded (all disabled/throttled/errored)',
  );
  return null;
}

/** Exposed for tests + diagnostic CLI. */
export const __for_testing = {
  TASK_ROUTES,
  throttledUntil,
  isThrottled,
  routeKey,
};
