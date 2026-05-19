/**
 * Phase 14 — item upgrade (Cường Hóa) shared logic.
 *
 * Both `/cong-phap upgrade` and `/weapon upgrade` route through this
 * module. Output is deterministic-given-seed (or wall-clock when omitted),
 * so tests can pin a seed and assert success/fail behavior.
 *
 *   level 0..10 (inclusive). 10 = max. 0 = unupgraded.
 *
 * Cost formula — Phase 14 economic rebalance (Bill 2026-05-20 round 2):
 * original doubling curve made L9→10 cost 1024 pills (≈600 days play to
 * max one item). Switched to linear so endgame is reachable in ~50 days
 * of steady play.
 *
 *   pills(L→L+1)   = 2 + L * 3       → 2, 5, 8, 11, 14, 17, 20, 23, 26, 29
 *   contrib(L→L+1) = 200 + L * 200   → 200, 400, 600, ..., 2000
 *
 * Total to max one item: 155 pills + 11_000 contribution.
 *
 * Success rates:
 *   - cong_phap: very forgiving (100% at L < 4, scales down to 20% at L 9→10)
 *   - weapon:    high-risk (95% at L 0, scales down to 3% at L 9→10)
 *
 * Fail behavior:
 *   - cong_phap: stay-put. User loses cost, level unchanged.
 *   - weapon: stay-put at L < 7. Downgrade −1 at L ≥ 7 (xianxia hardcore).
 *
 * Caller is responsible for: ownership check, equip check, calling store
 * to deduct cost + bump level + emit event.
 */

export const MAX_LEVEL = 10;

export interface UpgradeCost {
  pills: number;
  contribution: number;
}

export function costToUpgrade(currentLevel: number): UpgradeCost {
  if (currentLevel < 0 || currentLevel >= MAX_LEVEL) {
    return { pills: 0, contribution: 0 };
  }
  return {
    pills: 2 + currentLevel * 3,
    contribution: 200 + currentLevel * 200,
  };
}

const CONG_PHAP_SUCCESS: readonly number[] = [
  1.0, 1.0, 1.0, 1.0,   // 0..3 → 100%
  0.9,                  // 3→4
  0.8,                  // 4→5
  0.65,                 // 5→6
  0.5,                  // 6→7
  0.35,                 // 7→8
  0.2,                  // 8→9
] as const;

const WEAPON_SUCCESS: readonly number[] = [
  0.95, 0.9, 0.8, 0.65, 0.5,
  0.35, 0.25, 0.15, 0.08, 0.03,
] as const;

export function congPhapSuccessRate(currentLevel: number): number {
  if (currentLevel < 0 || currentLevel >= MAX_LEVEL) return 0;
  return CONG_PHAP_SUCCESS[currentLevel] ?? 0;
}

export function weaponSuccessRate(currentLevel: number): number {
  if (currentLevel < 0 || currentLevel >= MAX_LEVEL) return 0;
  return WEAPON_SUCCESS[currentLevel] ?? 0;
}

export type UpgradeOutcome =
  | { result: 'success'; newLevel: number }
  | { result: 'fail-stay'; newLevel: number }
  | { result: 'fail-downgrade'; newLevel: number };

/**
 * Roll an upgrade attempt. `kind` selects the success-rate + fail-behavior
 * table. Pass `rng()` returning [0,1) for deterministic tests.
 */
export function rollUpgrade(
  kind: 'cong_phap' | 'weapon',
  currentLevel: number,
  rng: () => number = Math.random,
): UpgradeOutcome {
  if (currentLevel < 0 || currentLevel >= MAX_LEVEL) {
    return { result: 'fail-stay', newLevel: currentLevel };
  }
  const rate = kind === 'cong_phap' ? congPhapSuccessRate(currentLevel) : weaponSuccessRate(currentLevel);
  const success = rng() < rate;
  if (success) {
    return { result: 'success', newLevel: currentLevel + 1 };
  }
  // Fail path — kind-specific.
  if (kind === 'weapon' && currentLevel >= 7) {
    return { result: 'fail-downgrade', newLevel: currentLevel - 1 };
  }
  return { result: 'fail-stay', newLevel: currentLevel };
}

export const __for_testing = { CONG_PHAP_SUCCESS, WEAPON_SUCCESS };
