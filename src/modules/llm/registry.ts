import { env } from '../../config/env.js';
import type { ProviderName } from './types.js';

/**
 * THE canonical source of production model eligibility.
 *
 * Radiant's AI runtime is ZERO-MONETARY-COST. That invariant is enforced
 * here and nowhere else — routing arrays elsewhere are just *preferences*,
 * they cannot grant a model the right to run.
 *
 * The rule that matters:
 *
 *     provider has paid products  !=  this configured route incurs cost
 *
 * Gemini and Groq both sell paid tiers, but the keys this repo is
 * configured with hit their $0 free tiers. So specific Gemini/Groq routes
 * ARE production-eligible, while `deepseek-v4-flash` (the paid twin of a
 * free model, same gateway) is NOT. Billing follows the *configured route*,
 * never the model name — `big-pickle` has no `-free` suffix but neither did
 * we find evidence it bills, so it is `unknown` and therefore blocked.
 *
 * FAIL CLOSED: anything absent from this registry is treated as `unknown`
 * and blocked. Adding a model to a routing chain without registering it
 * here makes that route dead, not dangerous.
 */

export type Billing = 'free' | 'paid' | 'unknown';

export type ModelStrength =
  | 'classification'
  | 'chat'
  | 'reasoning'
  | 'coding'
  | 'long_context'
  | 'vision'
  | 'structured_output'
  | 'multilingual';

export interface ModelConfig {
  id: string;
  provider: ProviderName;
  billing: Billing;
  /** False = never selected, even if billing is free (e.g. proven broken). */
  enabled: boolean;
  /** True = keep out of critical chains until probe/eval data exists. */
  experimental: boolean;
  speed: 'very_fast' | 'fast' | 'normal' | 'slow';
  strengths: readonly ModelStrength[];
  supportsVision: boolean;
  supportsStructuredOutput: boolean;
  supportsTools: boolean;
  /**
   * WHY this billing value. Required for every entry: a classification
   * without evidence is a guess, and guesses are how money gets spent.
   */
  billingEvidence: string;
  /**
   * Reasoning models emit hidden chain-of-thought before any visible
   * token. Under-fund them and they return an empty string with
   * finish_reason 'stop'. Router raises the budget to this floor.
   */
  minOutputTokens?: number;
  notes?: string;
}

/**
 * Gemini/Groq are free-tier ONLY while their projects have no billing
 * account attached. If that ever changes, flip the env flag and both
 * providers drop to `unknown` → blocked, with no code edit.
 */
const GEMINI_IS_FREE_TIER = !env.GEMINI_BILLING_ENABLED;
const GROQ_IS_FREE_TIER = !env.GROQ_BILLING_ENABLED;

const GEMINI_EVIDENCE = GEMINI_IS_FREE_TIER
  ? 'AI Studio key, no billing account attached (GEMINI_BILLING_ENABLED=false). Over-quota returns 429, never a charge.'
  : 'GEMINI_BILLING_ENABLED=true — a billing account is attached, so calls CAN incur cost.';

const GROQ_EVIDENCE = GROQ_IS_FREE_TIER
  ? 'Groq free tier, no billing account attached (GROQ_BILLING_ENABLED=false). Over-quota returns 429, never a charge.'
  : 'GROQ_BILLING_ENABLED=true — a billing account is attached, so calls CAN incur cost.';

const OZ_FREE_EVIDENCE =
  'OpenCode Zen `-free` SKU: separate zero-cost model id from its paid twin, returns FreeUsageLimitError/429 at quota instead of billing. Verified live 2026-08-13.';

export const MODEL_REGISTRY: readonly ModelConfig[] = [
  // ── OpenCode Zen — zero-cost free SKUs ──────────────────────────────
  {
    id: 'deepseek-v4-flash-free',
    provider: 'opencode-zen',
    billing: 'free',
    enabled: true,
    experimental: false,
    speed: 'normal',
    strengths: ['reasoning', 'coding', 'long_context', 'structured_output', 'multilingual'],
    supportsVision: false,
    supportsStructuredOutput: true,
    supportsTools: false,
    billingEvidence: OZ_FREE_EVIDENCE,
    // Returned 0 chars at a 2000-token budget on 2026-07-28: the whole
    // allowance went to hidden reasoning before any visible token.
    minOutputTokens: 3000,
    notes: 'Reasoning model, 1M ctx. Strongest free general/coding option.',
  },
  {
    id: 'mimo-v2.5-free',
    provider: 'opencode-zen',
    billing: 'free',
    enabled: true,
    experimental: false,
    speed: 'normal',
    strengths: ['chat', 'coding', 'vision', 'structured_output', 'multilingual'],
    // The ONLY free model here that accepts image parts. Losing it means
    // losing vision entirely — there is no paid substitute allowed.
    supportsVision: true,
    supportsStructuredOutput: true,
    supportsTools: false,
    billingEvidence: OZ_FREE_EVIDENCE,
    minOutputTokens: 1500,
    notes: 'Xiaomi MiMo v2.5, 256k ctx. Sole free vision model.',
  },
  {
    id: 'ling-3.0-tiny-free',
    provider: 'opencode-zen',
    billing: 'free',
    enabled: true,
    experimental: false,
    speed: 'very_fast',
    strengths: ['classification', 'chat', 'multilingual'],
    supportsVision: false,
    supportsStructuredOutput: true,
    supportsTools: false,
    billingEvidence: OZ_FREE_EVIDENCE,
    minOutputTokens: 600,
    notes:
      'Replaces the retired `ling-3.0-flash-free` (gateway 401 "not supported" since ~2026-08). Measured 4.7s / 1.2k chars of well-formed Vietnamese on 2026-08-13.',
  },
  {
    id: 'nemotron-3.5-lightning-free',
    provider: 'opencode-zen',
    billing: 'free',
    enabled: true,
    experimental: true,
    speed: 'very_fast',
    strengths: ['classification', 'structured_output'],
    supportsVision: false,
    supportsStructuredOutput: true,
    supportsTools: false,
    billingEvidence: OZ_FREE_EVIDENCE,
    minOutputTokens: 600,
    notes: 'Never exercised in production yet — probe before promoting.',
  },
  {
    id: 'nemotron-3-ultra-free',
    provider: 'opencode-zen',
    billing: 'free',
    enabled: true,
    experimental: true,
    speed: 'slow',
    strengths: ['reasoning', 'coding', 'long_context'],
    supportsVision: false,
    supportsStructuredOutput: true,
    supportsTools: false,
    billingEvidence: OZ_FREE_EVIDENCE,
    // Heavy reasoning: the most budget-hungry model in the pool.
    minOutputTokens: 3000,
    notes: 'Heavy hidden reasoning — keep off short-budget chains.',
  },
  {
    id: 'laguna-s-2.1-free',
    provider: 'opencode-zen',
    billing: 'free',
    enabled: true,
    experimental: false,
    speed: 'fast',
    strengths: ['chat', 'multilingual'],
    supportsVision: false,
    supportsStructuredOutput: false,
    supportsTools: false,
    billingEvidence: OZ_FREE_EVIDENCE,
    notes:
      'Answers directly with NO hidden reasoning — the only free model safe on a tight prose budget (narration).',
  },
  {
    id: 'hy3-free',
    provider: 'opencode-zen',
    billing: 'free',
    enabled: true,
    experimental: true,
    speed: 'normal',
    strengths: ['chat', 'coding'],
    supportsVision: false,
    supportsStructuredOutput: false,
    supportsTools: false,
    billingEvidence: OZ_FREE_EVIDENCE,
    minOutputTokens: 1500,
    notes: 'Unproven in this repo — probe/eval before production promotion.',
  },

  // ── OpenCode Zen — BLOCKED ──────────────────────────────────────────
  {
    id: 'big-pickle',
    provider: 'opencode-zen',
    billing: 'unknown',
    enabled: false,
    experimental: true,
    speed: 'normal',
    strengths: ['chat', 'reasoning'],
    supportsVision: false,
    supportsStructuredOutput: false,
    supportsTools: false,
    billingEvidence:
      'BLOCKED. Gateway /v1/models exposes no pricing field, and this id carries no `-free` SKU marker. Zero-cost status could not be established → fail closed (never infer billing from a name).',
  },
  {
    id: 'deepseek-v4-flash',
    provider: 'opencode-zen',
    billing: 'paid',
    enabled: false,
    experimental: false,
    speed: 'fast',
    strengths: ['reasoning', 'coding', 'long_context'],
    supportsVision: false,
    supportsStructuredOutput: true,
    supportsTools: true,
    billingEvidence:
      'BLOCKED. Paid twin of `deepseek-v4-flash-free` on the same gateway — the free SKU exists precisely because this one bills.',
  },
  {
    id: 'deepseek-v4-pro',
    provider: 'opencode-zen',
    billing: 'paid',
    enabled: false,
    experimental: false,
    speed: 'slow',
    strengths: ['reasoning', 'coding'],
    supportsVision: false,
    supportsStructuredOutput: true,
    supportsTools: true,
    billingEvidence: 'BLOCKED. Paid SKU on the OpenCode Zen gateway.',
  },

  // ── Gemini — AI Studio free tier ────────────────────────────────────
  {
    id: 'gemini-2.5-flash',
    provider: 'gemini',
    billing: GEMINI_IS_FREE_TIER ? 'free' : 'unknown',
    enabled: true,
    experimental: false,
    speed: 'fast',
    strengths: ['chat', 'reasoning', 'structured_output', 'multilingual', 'long_context'],
    supportsVision: false,
    supportsStructuredOutput: true,
    supportsTools: false,
    billingEvidence: GEMINI_EVIDENCE,
    notes:
      'Carried ~40% of answered traffic in the 7 days to 2026-08-13 while the OpenCode free pool was rate-limited. Removing it would have muted Aki, not saved money.',
  },
  {
    id: 'gemini-2.5-flash-lite',
    provider: 'gemini',
    billing: GEMINI_IS_FREE_TIER ? 'free' : 'unknown',
    enabled: true,
    experimental: false,
    speed: 'very_fast',
    strengths: ['classification', 'chat', 'structured_output'],
    supportsVision: false,
    supportsStructuredOutput: true,
    supportsTools: false,
    billingEvidence: GEMINI_EVIDENCE,
    notes: 'Own RPM/RPD bucket — real headroom when 2.5-flash is throttled.',
  },
  {
    id: 'gemini-3.1-flash-lite',
    provider: 'gemini',
    billing: GEMINI_IS_FREE_TIER ? 'free' : 'unknown',
    enabled: true,
    experimental: false,
    speed: 'very_fast',
    strengths: ['classification', 'chat', 'structured_output'],
    supportsVision: false,
    supportsStructuredOutput: true,
    supportsTools: false,
    billingEvidence: GEMINI_EVIDENCE,
  },

  // ── Groq — free tier ────────────────────────────────────────────────
  {
    id: 'llama-3.3-70b-versatile',
    provider: 'groq',
    billing: GROQ_IS_FREE_TIER ? 'free' : 'unknown',
    enabled: true,
    experimental: false,
    speed: 'very_fast',
    strengths: ['chat', 'structured_output', 'multilingual'],
    supportsVision: false,
    supportsStructuredOutput: true,
    supportsTools: false,
    billingEvidence: GROQ_EVIDENCE,
    notes:
      'Non-reasoning: every token goes to visible output, so it is safe on the tight narration budget.',
  },
  {
    id: 'llama-3.1-8b-instant',
    provider: 'groq',
    billing: GROQ_IS_FREE_TIER ? 'free' : 'unknown',
    enabled: true,
    experimental: false,
    speed: 'very_fast',
    strengths: ['classification', 'structured_output'],
    supportsVision: false,
    supportsStructuredOutput: true,
    supportsTools: false,
    billingEvidence: GROQ_EVIDENCE,
    notes: 'Replaces the retired `meta-llama/llama-4-scout-17b-16e-instruct` (404 on Groq).',
  },
  {
    id: 'openai/gpt-oss-120b',
    provider: 'groq',
    billing: GROQ_IS_FREE_TIER ? 'free' : 'unknown',
    enabled: true,
    experimental: false,
    speed: 'fast',
    strengths: ['reasoning', 'coding', 'structured_output'],
    supportsVision: false,
    supportsStructuredOutput: true,
    supportsTools: false,
    billingEvidence: GROQ_EVIDENCE,
    minOutputTokens: 1500,
    notes: 'Reasoning model — burns output budget on hidden CoT.',
  },
  {
    id: 'openai/gpt-oss-20b',
    provider: 'groq',
    billing: GROQ_IS_FREE_TIER ? 'free' : 'unknown',
    enabled: true,
    experimental: true,
    speed: 'very_fast',
    strengths: ['classification', 'structured_output'],
    supportsVision: false,
    supportsStructuredOutput: true,
    supportsTools: false,
    billingEvidence: GROQ_EVIDENCE,
    minOutputTokens: 1000,
  },
];

const BY_ID: ReadonlyMap<string, ModelConfig> = new Map(MODEL_REGISTRY.map((m) => [m.id, m]));

export function getModelConfig(modelId: string): ModelConfig | undefined {
  return BY_ID.get(modelId);
}

/**
 * The allowlist, derived — never hand-maintained in parallel. A model is
 * production-eligible only when it is registered, enabled, AND billing is
 * explicitly 'free'.
 */
export const FREE_PRODUCTION_MODELS: ReadonlySet<string> = new Set(
  MODEL_REGISTRY.filter((m) => m.enabled && m.billing === 'free').map((m) => m.id),
);

export function isProductionEligible(modelId: string): boolean {
  return FREE_PRODUCTION_MODELS.has(modelId);
}

/** Thrown when something tries to run a model that could cost money. */
export class PaidModelBlockedError extends Error {
  readonly modelId: string;
  readonly billing: Billing;
  constructor(modelId: string, billing: Billing, detail: string) {
    super(`PaidModelBlocked: "${modelId}" (billing=${billing}) — ${detail}`);
    this.name = 'PaidModelBlockedError';
    this.modelId = modelId;
    this.billing = billing;
  }
}

/**
 * THE enforcement point. Every production model invocation crosses this.
 *
 * Deliberately throws rather than returning a boolean: a caller that
 * forgets to check a boolean silently spends money, whereas a caller that
 * forgets to catch this crashes loudly in tests.
 */
export function assertModelAllowedForProduction(modelId: string): void {
  const cfg = getModelConfig(modelId);
  if (!cfg) {
    throw new PaidModelBlockedError(
      modelId,
      'unknown',
      'not in MODEL_REGISTRY. Unregistered models are treated as unknown-cost and blocked (fail closed).',
    );
  }
  if (cfg.billing !== 'free') {
    throw new PaidModelBlockedError(modelId, cfg.billing, cfg.billingEvidence);
  }
  if (!cfg.enabled) {
    throw new PaidModelBlockedError(
      modelId,
      cfg.billing,
      'registered free but explicitly disabled for production.',
    );
  }
}

export interface ModelAudit {
  freeEnabled: readonly string[];
  paidBlocked: readonly string[];
  unknownBlocked: readonly string[];
  disabledBlocked: readonly string[];
}

export function auditModelRegistry(): ModelAudit {
  const freeEnabled: string[] = [];
  const paidBlocked: string[] = [];
  const unknownBlocked: string[] = [];
  const disabledBlocked: string[] = [];
  for (const m of MODEL_REGISTRY) {
    if (m.billing === 'paid') paidBlocked.push(m.id);
    else if (m.billing === 'unknown') unknownBlocked.push(m.id);
    else if (!m.enabled) disabledBlocked.push(m.id);
    else freeEnabled.push(m.id);
  }
  return { freeEnabled, paidBlocked, unknownBlocked, disabledBlocked };
}

/**
 * Output-token floor for a model, so a reasoning model never gets a budget
 * it will spend entirely on hidden chain-of-thought.
 */
export function outputTokenFloor(modelId: string, requested: number | undefined): number {
  const cfg = getModelConfig(modelId);
  const floor = cfg?.minOutputTokens ?? 0;
  return Math.max(requested ?? 0, floor);
}
