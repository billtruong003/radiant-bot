import { logger } from '../../utils/logger.js';

/**
 * Per-model health tracking + circuit breaker.
 *
 * Free gateways are unstable in a specific way: they do not fail cleanly.
 * A model 429s for a few minutes, or returns `content: ''` because hidden
 * reasoning ate the whole budget, then recovers. Without memory between
 * calls the router re-tries the same dead route on every single message —
 * which is exactly what the 2026-08-13 logs show (45 wasted hops on a
 * retired model in 7 days).
 *
 * So: track outcomes, and let a repeatedly-failing model temporarily lose
 * routing priority. Deliberately in-memory only — no DB, no persistence.
 * A restart clearing the breakers is the correct behaviour, and the
 * alternative is a schema migration for data with a 5-minute shelf life.
 */

export type FailureKind =
  | 'rate_limit'
  | 'timeout'
  | 'server_error'
  | 'empty_output'
  | 'invalid_structure'
  | 'other';

interface ModelHealth {
  consecutiveFailures: number;
  /** Epoch ms when the breaker opens until. 0 = closed. */
  openUntil: number;
  /** Exponential moving average of successful-call latency, ms. */
  latencyEma: number;
  totalCalls: number;
  totalFailures: number;
  lastFailure?: FailureKind;
}

const health = new Map<string, ModelHealth>();

/** EMA smoothing. 0.3 = recent calls matter but one slow call can't dominate. */
const EMA_ALPHA = 0.3;

/**
 * Breaker opens after this many consecutive failures. Two is deliberate:
 * one failure is noise (a single 429 during a burst), two in a row means
 * the route is actually down right now.
 */
const FAILURE_THRESHOLD = 2;

/** Backoff per consecutive failure beyond the threshold, capped. */
const BASE_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_MS = 5 * 60_000;

function entry(modelId: string): ModelHealth {
  let h = health.get(modelId);
  if (!h) {
    h = { consecutiveFailures: 0, openUntil: 0, latencyEma: 0, totalCalls: 0, totalFailures: 0 };
    health.set(modelId, h);
  }
  return h;
}

export function recordSuccess(modelId: string, durationMs: number): void {
  const h = entry(modelId);
  h.consecutiveFailures = 0;
  h.openUntil = 0;
  h.totalCalls += 1;
  h.latencyEma = h.latencyEma === 0 ? durationMs : h.latencyEma * (1 - EMA_ALPHA) + durationMs * EMA_ALPHA;
}

/**
 * @param retryAfterMs Provider-supplied cooldown (429 Retry-After). When
 * present it wins over our backoff — the provider knows better than we do.
 */
export function recordFailure(modelId: string, kind: FailureKind, retryAfterMs?: number): void {
  const h = entry(modelId);
  h.consecutiveFailures += 1;
  h.totalCalls += 1;
  h.totalFailures += 1;
  h.lastFailure = kind;

  if (h.consecutiveFailures >= FAILURE_THRESHOLD) {
    const backoff = Math.min(
      BASE_COOLDOWN_MS * 2 ** (h.consecutiveFailures - FAILURE_THRESHOLD),
      MAX_COOLDOWN_MS,
    );
    const cooldown = Math.max(retryAfterMs ?? 0, backoff);
    h.openUntil = Date.now() + cooldown;
    logger.warn(
      { model: modelId, kind, consecutiveFailures: h.consecutiveFailures, cooldownMs: cooldown },
      'llm-health: circuit breaker OPEN',
    );
  } else if (retryAfterMs && retryAfterMs > 0) {
    // Single 429 — respect the provider's own cooldown without counting it
    // as a breaker trip.
    h.openUntil = Date.now() + retryAfterMs;
  }
}

/** True when the model is cooling down and must be skipped. */
export function isCircuitOpen(modelId: string, now: number = Date.now()): boolean {
  const h = health.get(modelId);
  return h !== undefined && h.openUntil > now;
}

export interface HealthSnapshot {
  modelId: string;
  healthy: boolean;
  consecutiveFailures: number;
  cooldownRemainingMs: number;
  latencyEmaMs: number;
  totalCalls: number;
  totalFailures: number;
  failureRate: number;
  lastFailure?: FailureKind;
}

export function snapshot(now: number = Date.now()): HealthSnapshot[] {
  return [...health.entries()].map(([modelId, h]) => ({
    modelId,
    healthy: h.openUntil <= now,
    consecutiveFailures: h.consecutiveFailures,
    cooldownRemainingMs: Math.max(0, h.openUntil - now),
    latencyEmaMs: Math.round(h.latencyEma),
    totalCalls: h.totalCalls,
    totalFailures: h.totalFailures,
    failureRate: h.totalCalls === 0 ? 0 : h.totalFailures / h.totalCalls,
    ...(h.lastFailure ? { lastFailure: h.lastFailure } : {}),
  }));
}

/** Test seam. */
export function __resetHealth(): void {
  health.clear();
}
