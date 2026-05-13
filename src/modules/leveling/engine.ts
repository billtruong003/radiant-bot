/**
 * XP curve from SPEC §2:
 *   xpToNext(level) = 5L^2 + 50L + 100
 * Reference points (cumulative XP to reach level):
 *   level 1   ≈ 100
 *   level 10  ≈ 1,800
 *   level 50  ≈ 110,000
 *   level 100 ≈ 835,000
 */
export function xpToNext(level: number): number {
  return 5 * level * level + 50 * level + 100;
}

export function levelFromXp(xp: number): number {
  let level = 0;
  let remaining = xp;
  while (remaining >= xpToNext(level)) {
    remaining -= xpToNext(level);
    level++;
  }
  return level;
}

/**
 * Total cumulative XP required to reach exactly the given level (sum of
 * xpToNext(0..level-1)). Inverse-ish of levelFromXp.
 */
export function cumulativeXpForLevel(level: number): number {
  let sum = 0;
  for (let i = 0; i < level; i++) {
    sum += xpToNext(i);
  }
  return sum;
}

/**
 * For UI progress bar: how far into the current level is the user?
 * Returns { current, needed, level } where 0 ≤ current < needed.
 */
export function levelProgress(xp: number): {
  level: number;
  currentInLevel: number;
  neededForNext: number;
} {
  const level = levelFromXp(xp);
  const floor = cumulativeXpForLevel(level);
  const needed = xpToNext(level);
  return {
    level,
    currentInLevel: xp - floor,
    neededForNext: needed,
  };
}
