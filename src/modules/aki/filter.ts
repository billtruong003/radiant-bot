import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { llm } from '../llm/index.js';
import { AKI_FILTER_SYSTEM_PROMPT, preFilterObvious } from './persona-filter.js';

/**
 * Aki filter stage. Sits BEFORE Grok in /ask. Classifies the question:
 *   - legit=true  → caller forwards to Grok for the real answer
 *   - legit=false → Aki's sass-tier rejection (no Grok call, saves $$$)
 *
 * Phase 11: rewritten to use the per-task LLM router. Primary provider
 * is Groq (free, fast 8B); fallback is Gemini. See `src/modules/llm/`.
 *
 * Fail-open policy (Bill's call, UX-first):
 *   - LLM error / both providers down / unparseable JSON → forward to
 *     Grok anyway (return {legit:true}). Cost is bounded by the
 *     existing per-user quota (100/day) + server daily budget cap, so
 *     a filter outage at worst lets through one user's quota.
 *
 * Costs are 0 on Groq free tier; ~$0.0001 if router falls back to
 * Gemini. Tracked per-call in AkiCallLog via filterMeta.
 */

export interface FilterResult {
  /** True = forward to Grok. False = use `response` directly. */
  legit: boolean;
  /** Mean-Aki rejection. Only set when legit=false. */
  response: string | null;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  /** Attribution for logging — see AkiCallLog.filter_stage. */
  source: 'groq' | 'gemini' | 'pre-filter' | 'fail-open' | 'disabled';
}

/**
 * True if at least one LLM provider has a key configured. False = the
 * router would always return null, so we short-circuit to fail-open.
 */
export function isFilterEnabled(): boolean {
  return env.GROQ_API_KEY.length > 0 || env.GEMINI_API_KEY.length > 0;
}

function stripFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```(?:json)?\s*\n?/i, '');
    s = s.replace(/\n?```\s*$/i, '');
  }
  return s.trim();
}

function parseFilterJson(raw: string): { legit: boolean; response: string | null } | null {
  try {
    const cleaned = stripFences(raw);
    const parsed = JSON.parse(cleaned) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const obj = parsed as { legit?: unknown; response?: unknown };
    if (typeof obj.legit !== 'boolean') return null;
    if (obj.legit) return { legit: true, response: null };
    if (typeof obj.response !== 'string' || obj.response.trim().length === 0) return null;
    return { legit: false, response: obj.response.trim() };
  } catch {
    return null;
  }
}

/**
 * Run the filter. Returns FilterResult. Never throws — fail-open by
 * design (errors → legit=true so /ask falls through to Grok).
 */
export async function runFilter(question: string): Promise<FilterResult> {
  // 0. Cheap local pre-filter for the obvious — skip LLM entirely.
  const obvious = preFilterObvious(question);
  if (obvious) {
    return {
      legit: false,
      response: obvious,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      source: 'pre-filter',
    };
  }

  // 1. Service entirely disabled (no provider keys) → fail-open.
  if (!isFilterEnabled()) {
    return {
      legit: true,
      response: null,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      source: 'disabled',
    };
  }

  // 2. Route through LLM. Returns null if both providers unavailable.
  const result = await llm.complete('aki-filter', {
    systemPrompt: AKI_FILTER_SYSTEM_PROMPT,
    userPrompt: question,
    responseFormat: 'json',
    maxOutputTokens: 200,
    temperature: 0.7,
  });

  if (!result) {
    logger.warn('aki-filter: no provider available, failing open');
    return {
      legit: true,
      response: null,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      source: 'fail-open',
    };
  }

  const parsed = parseFilterJson(result.text);
  if (!parsed) {
    logger.warn(
      { raw: result.text.slice(0, 300), provider: result.provider, model: result.model },
      'aki-filter: unparseable response, failing open',
    );
    return {
      legit: true,
      response: null,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
      source: 'fail-open',
    };
  }

  logger.info(
    {
      legit: parsed.legit,
      provider: result.provider,
      model: result.model,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      cost_usd: result.costUsd.toFixed(6),
      duration_ms: result.durationMs,
    },
    'aki-filter: classified',
  );

  return {
    legit: parsed.legit,
    response: parsed.response,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costUsd: result.costUsd,
    source: result.provider,
  };
}

/** Exposed for tests. */
export const __for_testing = {
  stripFences,
  parseFilterJson,
};
