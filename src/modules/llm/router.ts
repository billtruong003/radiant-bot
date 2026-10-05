import { logger } from '../../utils/logger.js';
import { isCircuitOpen, recordFailure, recordSuccess } from './health.js';
import { geminiProvider } from './providers/gemini.js';
import { groqProvider } from './providers/groq.js';
import { opencodeZenProvider } from './providers/opencode-zen.js';
import {
  PaidModelBlockedError,
  assertModelAllowedForProduction,
  getModelConfig,
  outputTokenFloor,
} from './registry.js';
import {
  type CompletionResult,
  type LlmProvider,
  LlmProviderError,
  LlmRateLimitError,
  type ProviderName,
  type TaskId,
} from './types.js';

/**
 * Per-task routing table + failover, over a ZERO-COST model pool only.
 *
 * A chain is a *preference order*, not a permission grant. Every hop is
 * validated against the model registry (`assertModelAllowedForProduction`)
 * before it can run, so editing an array here can make a route dead but
 * never expensive. That is the whole point: the guard lives below the
 * config, not beside it.
 *
 * Chains are model ids only — the provider is looked up from the registry.
 * Carrying both invited them to disagree, and a `{provider:'groq', model:
 * <a gemini model>}` typo fails at runtime in a way tests don't catch.
 *
 * Skip rules, in order: unregistered/non-free (throws), provider disabled
 * (no API key), circuit breaker open (recent repeated failures).
 *
 * Failure policy:
 *   - 429            → record + throttle that model, try next
 *   - provider error → record, try next
 *   - empty output   → record as failure, try next (see tryRoute)
 *   - all exhausted  → return null; caller degrades gracefully. NEVER a
 *                      paid escalation.
 */

/** Ordered preference list of model ids. */
type Chain = readonly string[];

const TASK_ROUTES: Record<TaskId, Chain> = {
  // ── Moderation / classification ─────────────────────────────────────
  // FILTER runs on EVERY question, so it burns free quota first; two
  // Gemini lites at the tail give it independent RPM buckets.
  'aki-filter': ['mimo-v2.5-free', 'ling-3.0-tiny-free', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
  'aki-nudge': ['mimo-v2.5-free', 'ling-3.0-tiny-free', 'gemini-2.5-flash'],
  // Request classifier. Only reached when the deterministic preflight
  // could not decide — see modules/aki/request-analysis.ts.
  'aki-triage': [
    'nemotron-3.5-lightning-free',
    'ling-3.0-tiny-free',
    'deepseek-v4-flash-free',
    'gemini-2.5-flash-lite',
  ],

  // ── Aki answer chains, one per workload ─────────────────────────────
  // Bootstrap ordering (spec §42) refined by the 2026-08-13 eval run.
  // Do not reorder from intuition — re-run `npm run eval:free-models`.
  'aki-answer-trivial': [
    'ling-3.0-tiny-free',
    'deepseek-v4-flash-free',
    'nemotron-3.5-lightning-free',
    'gemini-2.5-flash-lite',
  ],
  'aki-answer-general': [
    'deepseek-v4-flash-free',
    'mimo-v2.5-free',
    'ling-3.0-tiny-free',
    'gemini-2.5-flash',
  ],
  'aki-answer-technical': ['deepseek-v4-flash-free', 'mimo-v2.5-free', 'gemini-2.5-flash'],
  'aki-answer-coding': [
    'mimo-v2.5-free',
    'deepseek-v4-flash-free',
    'nemotron-3-ultra-free',
    'gemini-2.5-flash',
  ],
  'aki-answer-reasoning': [
    'nemotron-3-ultra-free',
    'deepseek-v4-flash-free',
    'mimo-v2.5-free',
    'gemini-2.5-flash',
  ],
  // 1M ctx first, then 256k. Gemini 2.5 Flash closes it (1M ctx too).
  'aki-answer-long-context': ['deepseek-v4-flash-free', 'mimo-v2.5-free', 'gemini-2.5-flash'],
  // VISION is deliberately a chain of ONE. MiMo is the only free model
  // that accepts image parts, and this repo's Gemini adapter sends text
  // parts only — adding it here would produce an answer written without
  // ever looking at the image, which is worse than admitting we can't.
  // When MiMo is down, askAki throws and the caller apologises. That is
  // the graceful degradation the zero-cost invariant requires.
  'aki-answer-vision': ['mimo-v2.5-free'],

  // ── Background jobs ─────────────────────────────────────────────────
  // MiMo is non-reasoning and returns JSON reliably; reasoning-heavy
  // models spent the whole budget on hidden CoT and returned empty, which
  // for a JSON task means a parse failure.
  'member-profile': ['mimo-v2.5-free', 'ling-3.0-tiny-free', 'gemini-2.5-flash'],
  'group-analytics': ['mimo-v2.5-free', 'ling-3.0-tiny-free', 'gemini-2.5-flash'],

  // Strict JSON + strong Vietnamese reading. Llama 3.3 70B has no
  // reasoning overhead and supports JSON mode.
  'doc-validate': [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'deepseek-v4-flash-free',
    'gemini-2.5-flash',
    'gemini-3.1-flash-lite',
  ],
  'divine-judgment': [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'nemotron-3-ultra-free',
    'ling-3.0-tiny-free',
    'gemini-2.5-flash',
  ],
  // The two guardian rungs use DIFFERENT lead models on purpose: asking
  // one model to check its own verdict just returns the same answer with
  // more confidence. DS V4 accuses, Ling defends.
  'guardian-judge': ['deepseek-v4-flash-free', 'mimo-v2.5-free', 'gemini-2.5-flash'],
  'guardian-review': ['ling-3.0-tiny-free', 'mimo-v2.5-free', 'gemini-2.5-flash'],

  // Cultivation prose on a tight budget → non-reasoning models only.
  // Anything that emits hidden CoT truncates the narration to nothing
  // (observed in prod 2026-05-14).
  narration: [
    'llama-3.3-70b-versatile',
    'laguna-s-2.1-free',
    'gemini-2.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash-lite',
  ],
};

const PROVIDERS: Record<ProviderName, LlmProvider> = {
  groq: groqProvider,
  gemini: geminiProvider,
  'opencode-zen': opencodeZenProvider,
};

export interface RouterInput {
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens?: number;
  temperature?: number;
  responseFormat?: 'text' | 'json';
  /** Only meaningful on the 'aki-answer-vision' chain. */
  imageUrl?: string;
}

export interface RouterResult extends CompletionResult {
  /** 0 = primary, 1 = first fallback, etc. Useful for logs / analytics. */
  routeIndex: number;
}

async function tryRoute(
  modelId: string,
  input: RouterInput,
  now: number,
): Promise<CompletionResult | null> {
  // ── THE billing boundary. Throws for paid / unknown / unregistered. ──
  // Not caught here: a paid model reaching this point is a programming
  // error that must be loud, not a route to silently skip.
  assertModelAllowedForProduction(modelId);

  const cfg = getModelConfig(modelId);
  if (!cfg) return null; // Unreachable — assert above throws first.

  const provider = PROVIDERS[cfg.provider];
  if (!provider.isEnabled()) return null;
  if (isCircuitOpen(modelId, now)) return null;

  const started = Date.now();
  try {
    const result = await provider.complete({
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      model: modelId,
      // Reasoning models need a floor or they spend the entire allowance
      // on hidden chain-of-thought and emit nothing.
      maxOutputTokens: outputTokenFloor(modelId, input.maxOutputTokens),
      temperature: input.temperature,
      responseFormat: input.responseFormat,
      imageUrl: input.imageUrl,
    });

    // An empty completion is a FAILURE, not a success — fall through to
    // the next route instead of handing the caller a blank answer. This is
    // the dominant failure mode of reasoning models on this pool.
    if (result.text.trim().length === 0) {
      recordFailure(modelId, 'empty_output');
      logger.warn(
        { model: modelId, tokensOut: result.tokensOut, maxOutputTokens: input.maxOutputTokens },
        'llm: route returned empty content (reasoning likely ate the budget), trying next',
      );
      return null;
    }

    recordSuccess(modelId, Date.now() - started);
    return result;
  } catch (err) {
    if (err instanceof LlmRateLimitError) {
      recordFailure(modelId, 'rate_limit', err.retryAfterMs);
      logger.warn(
        { model: modelId, retryAfterMs: err.retryAfterMs },
        'llm: route rate-limited (cooling down)',
      );
      return null;
    }
    if (err instanceof LlmProviderError) {
      const kind = /timeout|abort/i.test(err.message) ? 'timeout' : 'server_error';
      recordFailure(modelId, kind);
      logger.warn({ model: modelId, err: err.message }, 'llm: route errored, trying next');
      return null;
    }
    throw err;
  }
}

/**
 * Run a completion through the configured chain for `task`.
 *
 * Returns null when every route is unavailable, so the caller can degrade
 * gracefully. It will NEVER reach for a paid model to rescue the call —
 * a quiet Aki is the intended outcome of an exhausted free pool.
 */
export async function complete(task: TaskId, input: RouterInput): Promise<RouterResult | null> {
  const routes = TASK_ROUTES[task];
  const now = Date.now();

  for (let i = 0; i < routes.length; i++) {
    const modelId = routes[i];
    if (!modelId) continue;

    let result: CompletionResult | null;
    try {
      result = await tryRoute(modelId, input, now);
    } catch (err) {
      if (err instanceof PaidModelBlockedError) {
        // Misconfiguration, not a transient fault. Skip the route and
        // shout — but keep serving the request from the free pool.
        logger.error({ task, model: modelId, err: err.message }, 'llm: BLOCKED non-free route');
        continue;
      }
      throw err;
    }

    if (result) {
      if (i > 0) {
        logger.info(
          { task, routeIndex: i, provider: result.provider, model: modelId },
          'llm: routed to fallback',
        );
      }
      return { ...result, routeIndex: i };
    }
  }

  logger.error(
    { task, totalRoutes: routes.length },
    'llm: no free route succeeded (all disabled/cooling/errored) — degrading, NOT escalating to paid',
  );
  return null;
}

/** Exposed for tests + diagnostic CLI. */
export const __for_testing = {
  TASK_ROUTES,
};

export { TASK_ROUTES };
