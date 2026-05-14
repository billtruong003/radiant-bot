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
  // Filter primary = 70B for classification nuance — 8B was misclassifying
  // borderline VN questions ("Aki ở đâu?") as trash and improvising
  // incoherent sass. 70B Versatile has 1K RPD on Groq free which still
  // covers ~10 daily-maxed users at the 100/user/day quota. 8B falls
  // through as a "fast path" if 70B is exhausted, then Gemini chain.
  'aki-filter': [
    { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    { provider: 'groq', model: 'llama-3.1-8b-instant' },
    { provider: 'gemini', model: 'gemini-2.0-flash' },
    { provider: 'gemini', model: 'gemini-2.5-flash' },
    { provider: 'gemini', model: 'gemini-2.5-flash-lite' },
  ],
  // Nudge is short, simple "kiềm chế lời" reminders — 8B is fine here
  // (no nuanced classification, just persona-flavored text).
  'aki-nudge': [
    { provider: 'groq', model: 'llama-3.1-8b-instant' },
    { provider: 'gemini', model: 'gemini-2.0-flash' },
    { provider: 'gemini', model: 'gemini-2.5-flash-lite' },
  ],
  // Narration needs prose quality — keep the better models early in the
  // chain. Groq 70B 1K RPD is the budget; Gemini 2.5 Flash (better prose
  // than Lite) is the prose-priority fallback. Lite is last-resort.
  narration: [
    { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    { provider: 'gemini', model: 'gemini-2.5-flash' },
    { provider: 'gemini', model: 'gemini-2.0-flash' },
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
