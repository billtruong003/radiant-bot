import { CULTIVATION_RANKS, rankById, rankIndex } from '../../config/cultivation.js';
import { getTitle } from '../../config/titles.js';
import { getStore } from '../../db/index.js';
import type { CultivationRankId, User, Weapon } from '../../db/types.js';
import type { AvatarLook } from '../avatar/catalog.js';
import { getLook } from '../avatar/service.js';
import { getBanMenhTemplate } from '../combat/ban-menh-templates.js';
import { NHAN_SLOT_UNLOCK, resolveEquippedSlots } from '../combat/equipment-resolver.js';
import { type CombatPowerBreakdown, computeCombatPowerBreakdown } from '../combat/power.js';
import { levelProgress } from '../leveling/engine.js';
import { congPhapIcon, nhanIcon, phapKhiIcon, weaponIcon } from '../pixel/icons.js';
import { RARITY_COLOR, RARITY_NAME, TIER_COLOR, TIER_NAME } from '../pixel/palette.js';

/**
 * Everything the profile-style cards need about one member, gathered once
 * from the store so each card stays a pure drawing function.
 */

export interface GearView {
  slot: string;
  icon: string;
  name: string;
  grade: string;
  color: string;
  level: number;
}

export interface ProfileData {
  discordId: string;
  name: string;
  look: AvatarLook | null;
  user: User;
  rank: CultivationRankId;
  rankName: string;
  level: number;
  xpInLevel: number;
  xpNeeded: number;
  totalXp: number;
  nextRealm: { name: string; level: number } | null;
  power: CombatPowerBreakdown;
  alloc: { dmg: number; hp: number; def: number; spd: number };
  unspent: number;
  pills: number;
  coins: number;
  streak: number;
  title: string | null;
  subTitle: string | null;
  weapon: GearView | null;
  phapKhi: GearView | null;
  rings: (GearView | null)[];
  ringLocked: (string | null)[];
  congPhap: GearView[];
}

export const fmt = (n: number): string => n.toLocaleString('en-US');

function weaponView(
  discordId: string,
  slug: string | null | undefined,
  level: number,
): GearView | null {
  if (!slug) return null;
  const store = getStore();
  let w: Weapon | null = store.weaponCatalog.get(slug) ?? null;
  if (!w && slug.includes('ban-menh')) w = getBanMenhTemplate(discordId);
  if (!w) return null;
  return {
    slot: 'Vũ khí',
    icon: weaponIcon(w),
    name: w.display_name.replace(/\s*\(Bản Mệnh\)/, ''),
    grade: TIER_NAME[w.tier] ?? w.tier,
    color: TIER_COLOR[w.tier] ?? '#9aa3ad',
    level,
  };
}

export function profileData(discordId: string, name: string): ProfileData | null {
  const store = getStore();
  const user = store.users.get(discordId);
  if (!user) return null;
  const slots = resolveEquippedSlots(discordId);
  const power = computeCombatPowerBreakdown(
    user,
    slots.congPhap,
    slots.phapKhi,
    slots.nhan,
    slots.weapon,
  );
  const prog = levelProgress(user.xp);
  const ri = rankIndex(user.cultivation_rank);
  const next = CULTIVATION_RANKS[ri + 1];
  const title = user.equipped_title_id ? getTitle(user.equipped_title_id) : null;
  const rings: (GearView | null)[] = [];
  const ringLocked: (string | null)[] = [];
  for (const u of NHAN_SLOT_UNLOCK) {
    const open = ri >= rankIndex(u.minRank);
    const n = slots.nhan[u.slotIdx];
    ringLocked.push(open ? null : rankById(u.minRank).name);
    rings.push(
      n && open
        ? {
            slot: `Nhẫn ${u.slotIdx + 1}`,
            icon: nhanIcon(n),
            name: n.name,
            grade: RARITY_NAME[n.rarity] ?? n.rarity,
            color: RARITY_COLOR[n.rarity] ?? '#9aa3ad',
            level: 0,
          }
        : null,
    );
  }
  return {
    discordId,
    name,
    look: getLook(discordId),
    user,
    rank: user.cultivation_rank,
    rankName: rankById(user.cultivation_rank).name,
    level: prog.level,
    xpInLevel: prog.currentInLevel,
    xpNeeded: prog.neededForNext,
    totalXp: user.xp,
    nextRealm: next ? { name: next.name, level: next.minLevel } : null,
    power,
    alloc: user.stat_alloc ?? { dmg: 0, hp: 0, def: 0, spd: 0 },
    unspent: user.stat_points_unspent ?? 0,
    pills: user.pills ?? 0,
    coins: user.contribution_points ?? 0,
    streak: user.daily_streak ?? 0,
    title: title?.name ?? null,
    subTitle: user.sub_title ?? null,
    weapon: weaponView(discordId, user.equipped_weapon_slug, slots.weapon?.level ?? 0),
    phapKhi: slots.phapKhi
      ? {
          slot: 'Pháp khí',
          icon: phapKhiIcon(slots.phapKhi.item),
          name: slots.phapKhi.item.name,
          grade: RARITY_NAME[slots.phapKhi.item.rarity] ?? slots.phapKhi.item.rarity,
          color: RARITY_COLOR[slots.phapKhi.item.rarity] ?? '#9aa3ad',
          level: slots.phapKhi.level,
        }
      : null,
    rings,
    ringLocked,
    congPhap: slots.congPhap.map((c, i) => ({
      slot: `Ô ${i + 1}`,
      icon: congPhapIcon(c.item),
      name: c.item.name,
      grade: RARITY_NAME[c.item.rarity] ?? c.item.rarity,
      color: RARITY_COLOR[c.item.rarity] ?? '#9aa3ad',
      level: c.level,
    })),
  };
}
