import { ulid } from 'ulid';
import { TITLES, type TitleEarnContext } from '../../config/titles.js';
import { getStore } from '../../db/index.js';
import type { User, UserTitle } from '../../db/types.js';
import { logger } from '../../utils/logger.js';

/**
 * Phase 14 — title (danh hiệu) award + lookup module.
 *
 * `awardEligibleTitles(userId)` runs each registered TitleDef.check against
 * the user's current state + lifetime counters and grants any newly-earned
 * titles. Called from event hooks (duel win, miểu sát, tribulation pass,
 * upgrade success, rank promotion). Idempotent: titles already owned are
 * skipped, so re-calling after every event is safe + cheap.
 *
 * Lifetime counters are derived on-the-fly from existing logs (xpLogs for
 * tribulation passes, automodLogs is unused here, weaponCatalog + ownership
 * scans for "max level" titles). Querying the in-memory store is O(N) but
 * N stays small (≤ a few thousand per user) and titles fire at user-paced
 * events, so the cost is fine without an explicit counter cache.
 */

function buildContext(user: User): TitleEarnContext {
  const store = getStore();
  const userId = user.discord_id;

  // Duel wins + miểu sát — counted from xp_logs with the dedicated Phase 14
  // sources ('duel_win', 'mieu_sat'). The XP amount on those rows is 0
  // (the row is a counter marker); their EXISTENCE drives title eligibility.
  const duelWins = store.xpLogs.query(
    (l) => l.discord_id === userId && l.source === 'duel_win',
  ).length;
  const mieuSatCount = store.xpLogs.query(
    (l) => l.discord_id === userId && l.source === 'mieu_sat',
  ).length;
  // Tribulation passes — counted from xp_logs where source='tribulation_pass'.
  const tribulationPasses = store.xpLogs
    .query((l) => l.discord_id === userId && l.source === 'tribulation_pass')
    .length;
  const legendaryCongPhapCount = store.userCongPhap
    .query((uc) => uc.discord_id === userId)
    .map((uc) => store.congPhapCatalog.get(uc.cong_phap_slug))
    .filter((cp) => cp?.rarity === 'legendary').length;
  const ownedWeapons = store.userWeapons.query((w) => w.discord_id === userId);
  const maxWeaponLevel = ownedWeapons.reduce((m, w) => Math.max(m, w.level ?? 0), 0);
  const ownedCongPhap = store.userCongPhap.query((uc) => uc.discord_id === userId);
  const maxCongPhapLevel = ownedCongPhap.reduce((m, uc) => Math.max(m, uc.level ?? 0), 0);
  const approvedDocsCount = store.docContributions.query(
    (d) => d.author_id === userId && d.status === 'approved',
  ).length;

  return {
    user,
    duelWins,
    mieuSatCount,
    tribulationPasses,
    legendaryCongPhapCount,
    maxWeaponLevel,
    maxCongPhapLevel,
    approvedDocsCount,
  };
}

/**
 * Optional caller-supplied counter overrides — used by event hooks that know
 * the precise lifetime count (e.g., /duel handler has tracked duel_win count
 * in-memory). Skipped counters fall back to derived defaults.
 */
export interface TitleContextOverrides {
  duelWins?: number;
  mieuSatCount?: number;
}

export function listOwnedTitleIds(discordId: string): Set<string> {
  const owned = getStore().userTitles.query((t) => t.discord_id === discordId);
  return new Set(owned.map((t) => t.title_id));
}

export async function awardEligibleTitles(
  discordId: string,
  overrides: TitleContextOverrides = {},
): Promise<string[]> {
  const store = getStore();
  const user = store.users.get(discordId);
  if (!user) return [];

  const ctx = { ...buildContext(user), ...overrides };
  const owned = listOwnedTitleIds(discordId);
  const newlyEarned: string[] = [];

  for (const def of TITLES) {
    if (owned.has(def.id)) continue;
    if (!def.check(ctx)) continue;
    const row: UserTitle = {
      id: ulid(),
      discord_id: discordId,
      title_id: def.id,
      earned_at: Date.now(),
    };
    await store.userTitles.set(row);
    newlyEarned.push(def.id);
    logger.info(
      { discord_id: discordId, title_id: def.id, title_name: def.name },
      'titles: awarded',
    );
  }

  return newlyEarned;
}

export const __for_testing = { buildContext };
