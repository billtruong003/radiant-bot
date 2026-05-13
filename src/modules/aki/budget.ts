import { env } from '../../config/env.js';
import { getStore } from '../../db/index.js';
import { dayKey } from '../leveling/daily.js';

/**
 * Budget enforcement for Aki. Server-wide cap on cost per VN calendar
 * day (Asia/Ho_Chi_Minh). Aggregates `AkiCallLog.cost_usd` over the
 * current day; refuses new /ask if cumulative ≥ AKI_DAILY_BUDGET_USD.
 *
 * Uses the same `dayKey` helper as /daily so "today" matches the
 * user's expectation (Vietnamese calendar, not UTC).
 */

export interface BudgetStatus {
  todaySpent: number;
  budget: number;
  remaining: number;
  exhausted: boolean;
}

export function getTodaySpentUsd(now: number = Date.now()): number {
  const today = dayKey(now);
  let sum = 0;
  for (const log of getStore().akiLogs.query((l) => dayKey(l.created_at) === today)) {
    if (!log.refusal) sum += log.cost_usd;
  }
  return sum;
}

export function getBudgetStatus(now: number = Date.now()): BudgetStatus {
  const todaySpent = getTodaySpentUsd(now);
  const budget = env.AKI_DAILY_BUDGET_USD;
  const remaining = Math.max(0, budget - todaySpent);
  return {
    todaySpent,
    budget,
    remaining,
    exhausted: todaySpent >= budget,
  };
}

/**
 * Quick gate — call BEFORE askAki to refuse early if the daily budget
 * is exhausted.
 */
export function isBudgetExhausted(now: number = Date.now()): boolean {
  return getBudgetStatus(now).exhausted;
}
