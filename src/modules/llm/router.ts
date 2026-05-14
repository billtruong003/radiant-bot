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
 * Each TaskId has a primary + fallback (provider, model) tuple. The
 * caller passes the task ID; router picks the best provider, handles
 * 429 throttle bookkeeping, and falls back automatically on error.
 *
 * Why per-task: Groq's free RPD limits differ per model. The 8B model
 * has 14.4K RPD (great for filter on every /ask); the 70B has 1K RPD
 * (perfect for narration which fires once per level-up). Mapping the
 * right model to the right task keeps both rooms under quota.
 *
 * Failover policy (per Bill's call):
 *   - Provider throws LlmRateLimitError → mark throttled for retryAfterMs,
 *     then try fallback. Next call to same task within window skips
 *     primary entirely.
 *   - Provider throws LlmProviderError → try fallback once without
 *     throttling primary (transient issue, retry next call).
 *   - All providers fail → throw to caller. Caller decides UX:
 *       filter   = fail-open (forward to Grok anyway)
 *       nudge    = silent skip
 *       narration = static fallback message
 */

interface Route {
  provider: ProviderName;
  model: string;
}

interface TaskRoute {
  primary: Route;
  fallback: Route;
}

const TASK_ROUTES: Record<TaskId, TaskRoute> = {
  'aki-filter': {
    primary: { provider: 'groq', model: 'llama-3.1-8b-instant' },
    fallback: { provider: 'gemini', model: 'gemini-2.0-flash' },
  },
  'aki-nudge': {
    primary: { provider: 'groq', model: 'llama-3.1-8b-instant' },
    fallback: { provider: 'gemini', model: 'gemini-2.0-flash' },
  },
  narration: {
    primary: { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    fallback: { provider: 'gemini', model: 'gemini-2.0-flash' },
  },
};

const PROVIDERS: Record<ProviderName, LlmProvider> = {
  groq: groqProvider,
  gemini: geminiProvider,
};

// In-memory throttle map. Key = provider name. Value = epoch ms when
// it becomes usable again. Module-scoped because router state is
// per-process and rate limits reset on restart anyway.
const throttledUntil: Map<ProviderName, number> = new Map();

function isThrottled(provider: ProviderName, now: number): boolean {
  const until = throttledUntil.get(provider);
  return until !== undefined && now < until;
}

function throttleFor(provider: ProviderName, ms: number, now: number): void {
  throttledUntil.set(provider, now + ms);
}

export interface RouterInput {
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens?: number;
  temperature?: number;
  responseFormat?: 'text' | 'json';
}

export interface RouterResult extends CompletionResult {
  /** Which route was actually used. Useful for logs / analytics. */
  routePosition: 'primary' | 'fallback';
}

async function tryRoute(
  route: Route,
  input: RouterInput,
  now: number,
): Promise<CompletionResult | null> {
  const provider = PROVIDERS[route.provider];
  if (!provider.isEnabled()) return null;
  if (isThrottled(route.provider, now)) return null;

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
      throttleFor(route.provider, err.retryAfterMs ?? 30_000, now);
      logger.warn(
        {
          provider: route.provider,
          model: route.model,
          retryAfterMs: err.retryAfterMs,
        },
        'llm: provider throttled',
      );
      return null;
    }
    if (err instanceof LlmProviderError) {
      logger.warn(
        { provider: route.provider, model: route.model, err: err.message },
        'llm: provider error, will try fallback',
      );
      return null;
    }
    // Unexpected — let it bubble.
    throw err;
  }
}

/**
 * Run a completion through the configured route for `task`. Returns null
 * if both primary and fallback are unavailable (disabled, throttled, or
 * errored) so the caller can apply task-specific degradation.
 */
export async function complete(task: TaskId, input: RouterInput): Promise<RouterResult | null> {
  const route = TASK_ROUTES[task];
  const now = Date.now();

  const primaryResult = await tryRoute(route.primary, input, now);
  if (primaryResult) {
    return { ...primaryResult, routePosition: 'primary' };
  }

  const fallbackResult = await tryRoute(route.fallback, input, now);
  if (fallbackResult) {
    logger.info(
      { task, primary: route.primary.provider, used: route.fallback.provider },
      'llm: routed to fallback',
    );
    return { ...fallbackResult, routePosition: 'fallback' };
  }

  logger.error({ task }, 'llm: no provider available (primary + fallback both unavailable)');
  return null;
}

/** Exposed for tests + diagnostic CLI. */
export const __for_testing = {
  TASK_ROUTES,
  throttledUntil,
  isThrottled,
};
