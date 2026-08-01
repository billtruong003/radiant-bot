import { logger } from '../../utils/logger.js';
import { geminiProvider } from './providers/gemini.js';
import { groqProvider } from './providers/groq.js';
import { opencodeZenProvider } from './providers/opencode-zen.js';
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
  // FILTER — decides whether a member's question is worth answering at all.
  // 2026-08-01: moved onto the same DS/Ling/MiMo tier as the answer path.
  // A weak model here is expensive: on 2026-07-29 it rejected the Chưởng
  // Môn's own moderation report as junk.
  //
  // Two Gemini models at the tail, unlike the other Aki chains: the filter
  // runs on EVERY question, so it exhausts free quota first. Each Gemini
  // model has its own RPM/RPD bucket, so the second entry doubles the
  // emergency headroom for days when OpenCode Zen is down.
  'aki-filter': [
    { provider: 'opencode-zen', model: 'mimo-v2.5-free' },
    { provider: 'opencode-zen', model: 'ling-3.0-flash-free' },
    { provider: 'gemini', model: 'gemini-2.5-flash' },
    { provider: 'gemini', model: 'gemini-2.5-flash-lite' },
  ],
  // NUDGE — short "kiềm chế lời" reminders. Same tier: the nudge is aimed
  // at a real member being told off, so tone precision matters.
  'aki-nudge': [
    { provider: 'opencode-zen', model: 'mimo-v2.5-free' },
    { provider: 'opencode-zen', model: 'ling-3.0-flash-free' },
    { provider: 'gemini', model: 'gemini-2.5-flash' },
  ],
  // ── Phase 15: Aki's answer engine, fully free-tier ──
  //
  // TRIAGE — one cheap call that decides easy vs hard. Ling leads: it
  // emits hidden reasoning but the output here is one word, which the
  // 600-token budget absorbs.
  //
  // Bill's call (2026-08-01): Aki's answer path runs on DS V4 / Ling / MiMo
  // ONLY. The weaker free models (laguna, north-mini, nemotron) and the
  // Groq llamas were dropped — members were visibly noticing the drop in
  // quality ("Dm ngu vl", "Não cá vàng 3s", "Hiểu ngữ cảnh ko đc ổn lắm").
  // gemini-2.5-flash stays as the LAST hop only: it is a strong model, not
  // a weak lane, and without any tail a single OpenCode outage would leave
  // Aki completely mute.
  'aki-triage': [
    { provider: 'opencode-zen', model: 'ling-3.0-flash-free' },
    { provider: 'opencode-zen', model: 'mimo-v2.5-free' },
    { provider: 'gemini', model: 'gemini-2.5-flash' },
  ],
  // EASY — chit-chat, short factual answers, persona banter. MiMo first
  // (fast, and the only free vision model here, so behaviour stays
  // consistent between the text and image paths).
  'aki-answer-easy': [
    { provider: 'opencode-zen', model: 'mimo-v2.5-free' },
    { provider: 'opencode-zen', model: 'ling-3.0-flash-free' },
    { provider: 'opencode-zen', model: 'deepseek-v4-flash-free' },
    { provider: 'gemini', model: 'gemini-2.5-flash' },
  ],
  // HARD — code, debugging, multi-step explanation.
  //
  // DS V4 now LEADS the hard chain (was behind llama-70b). It previously
  // returned empty because 2000 tokens all went to hidden reasoning — so
  // `answerTokenBudget()` was raised to 3000 for this chain specifically.
  // `tryRoute` still treats an empty completion as a failure, so a stall
  // costs one hop rather than a blank reply.
  'aki-answer-hard': [
    { provider: 'opencode-zen', model: 'deepseek-v4-flash-free' },
    { provider: 'opencode-zen', model: 'ling-3.0-flash-free' },
    { provider: 'opencode-zen', model: 'mimo-v2.5-free' },
    { provider: 'gemini', model: 'gemini-2.5-flash' },
  ],
  // VISION — must stay on models that accept image parts. MiMo v2.5 is
  // the free vision model; Gemini closes the chain. Never add a text-only
  // model here: it would silently answer without seeing the image.
  'aki-answer-vision': [
    { provider: 'opencode-zen', model: 'mimo-v2.5-free' },
    { provider: 'gemini', model: 'gemini-2.5-flash' },
  ],
  // MEMBER-PROFILE + GROUP-ANALYTICS — Phase 15 knowledge base.
  //
  // Background jobs, same DS/Ling/MiMo tier (2026-08-01). MiMo is
  // non-reasoning and returns JSON reliably; Ling backs it up. Gemini is
  // the tail so an OpenCode outage still produces a report.
  //
  // Reasoning-heavy free models are deliberately NOT here: they were
  // observed spending the entire token budget on hidden chain-of-thought
  // and returning empty, which for a JSON task means a parse failure.
  'member-profile': [
    { provider: 'opencode-zen', model: 'mimo-v2.5-free' },
    { provider: 'opencode-zen', model: 'ling-3.0-flash-free' },
    { provider: 'gemini', model: 'gemini-2.5-flash' },
  ],
  'group-analytics': [
    { provider: 'opencode-zen', model: 'mimo-v2.5-free' },
    { provider: 'opencode-zen', model: 'ling-3.0-flash-free' },
    { provider: 'gemini', model: 'gemini-2.5-flash' },
  ],
  // DOC-VALIDATE — Phase 12 Lát 9 doc gatekeeper. Needs reliable JSON
  // output + strong VN reading comprehension. Llama 3.3 70B has the best
  // tradeoff (no reasoning overhead, supports JSON mode, strong VN).
  // 2026-07-28: added 2 OpenCode Zen free models before Gemini — 600-token
  // budget here tolerates their hidden-reasoning overhead fine (verified
  // live). `north-mini-code-free` picked for its code/technical framing,
  // matching this task's "doc gatekeeper" role.
  'doc-validate': [
    { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    { provider: 'groq', model: 'meta-llama/llama-4-scout-17b-16e-instruct' },
    { provider: 'opencode-zen', model: 'north-mini-code-free' },
    { provider: 'opencode-zen', model: 'deepseek-v4-flash-free' },
    { provider: 'gemini', model: 'gemini-2.5-flash' },
    { provider: 'gemini', model: 'gemini-3.1-flash-lite' },
  ],
  // DIVINE-JUDGMENT — Phase 12.4 Áp Chế Thiên Đạo. Same shape as
  // doc-validate (strict JSON, VN reasoning). Reuse the chain.
  // 2026-07-28: added `nemotron-3-ultra-free` (heavy-reasoning free
  // model — thematically apt for a "judgment" task, 600-token budget
  // tolerates it) + `ling-3.0-flash-free` before Gemini.
  'divine-judgment': [
    { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    { provider: 'groq', model: 'meta-llama/llama-4-scout-17b-16e-instruct' },
    { provider: 'opencode-zen', model: 'nemotron-3-ultra-free' },
    { provider: 'opencode-zen', model: 'ling-3.0-flash-free' },
    { provider: 'gemini', model: 'gemini-2.5-flash' },
    { provider: 'gemini', model: 'gemini-3.1-flash-lite' },
  ],
  // NARRATION — cultivation-themed prose. Llama 3.3 70B first because it
  // is non-reasoning (no `<think>` overhead, every token goes to prose)
  // and gives strong VN xianxia output. gpt-oss-120b is a reasoning
  // model — kept in chain as fallback but it burns output budget on
  // chain-of-thought even with `reasoning_format: 'hidden'`, which on
  // 2026-05-14 caused empty/truncated narration in prod (only 400-token
  // budget here). 2026-07-28: dropped `qwen/qwen3-32b` (Groq retired the
  // model, was 404-ing every call). Deliberately did NOT replace it with
  // one of the new OpenCode Zen reasoning models (north-mini/ling/
  // nemotron all emit hidden reasoning first) — same failure mode as the
  // 2026-05-14 incident. Added `laguna-s-2.1-free` instead: verified live
  // to answer directly with no reasoning overhead, safe for this budget.
  narration: [
    { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    { provider: 'groq', model: 'meta-llama/llama-4-scout-17b-16e-instruct' },
    { provider: 'groq', model: 'openai/gpt-oss-120b' },
    { provider: 'opencode-zen', model: 'laguna-s-2.1-free' },
    { provider: 'gemini', model: 'gemini-2.5-flash' },
    { provider: 'gemini', model: 'gemini-3.1-flash-lite' },
    { provider: 'gemini', model: 'gemini-2.5-flash-lite' },
  ],
};

const PROVIDERS: Record<ProviderName, LlmProvider> = {
  groq: groqProvider,
  gemini: geminiProvider,
  'opencode-zen': opencodeZenProvider,
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
  /** Only meaningful on the 'aki-answer-vision' chain. */
  imageUrl?: string;
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
    const result = await provider.complete({
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      model: route.model,
      maxOutputTokens: input.maxOutputTokens,
      temperature: input.temperature,
      responseFormat: input.responseFormat,
      imageUrl: input.imageUrl,
    });

    // An empty completion is a FAILURE, not a success — fall through to
    // the next route instead of handing callers a blank answer.
    //
    // This is the dominant failure mode of reasoning models (DeepSeek V4
    // Flash, Nemotron, north-mini, Ling): they spend the whole
    // maxOutputTokens budget on hidden chain-of-thought and return
    // content:'' with finish_reason:'stop'. Observed live 2026-07-28 —
    // deepseek-v4-flash-free returned 0 chars for a code question even at
    // a 2000-token budget. Without this guard the router reported success
    // and Aki replied with nothing at all.
    if (result.text.trim().length === 0) {
      logger.warn(
        {
          provider: route.provider,
          model: route.model,
          tokensOut: result.tokensOut,
          maxOutputTokens: input.maxOutputTokens,
        },
        'llm: route returned empty content (likely reasoning ate the budget), trying next',
      );
      return null;
    }

    return result;
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
