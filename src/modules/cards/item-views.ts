import { rankById, rankIndex } from '../../config/cultivation.js';
import { getStore } from '../../db/index.js';
import type {
  CongPhap,
  CultivationRankId,
  Nhan,
  PhapKhi,
  User,
  Weapon,
  WeaponStats,
} from '../../db/types.js';
import { getLook } from '../avatar/service.js';
import { BAN_MENH_SLUG_PREFIX, getBanMenhTemplate } from '../combat/ban-menh-templates.js';
import { readEquippedRingSlugs } from '../combat/equipment-resolver.js';
import { congPhapIcon, nhanIcon, phapKhiIcon, weaponIcon } from '../pixel/icons.js';
import type { Rendered } from '../pixel/output.js';
import {
  PX,
  RARITY_COLOR,
  RARITY_NAME,
  REALM_COLOR,
  TIER_COLOR,
  TIER_NAME,
} from '../pixel/palette.js';
import {
  type BagItem,
  type ItemDetail,
  type ItemView,
  type ShopItem,
  renderInventoryCard,
  renderShopCard,
} from './dodac-cards.js';
import type { Fighter } from './duel-cards.js';
import type { BoardEntry } from './leaderboard-card.js';
import { fmt } from './profile-data.js';

/**
 * Store entities → the plain views the item cards draw. Kept apart from the
 * commands so /gear, /inventory, /shop and /trade all show an item the same way.
 */

const GREY = '#9aa3ad';

const CATEGORY_LABEL: Record<string, string> = {
  blunt: 'cùn',
  pierce: 'xuyên phá',
  spirit: 'linh khí',
};

export interface WeaponRef {
  weapon: Weapon;
  stats: WeaponStats;
  banMenh: boolean;
}

/** Catalog weapon, or the member's bản mệnh (stats from their own row). */
export function resolveWeapon(discordId: string, slug: string): WeaponRef | null {
  const store = getStore();
  const catalog = store.weaponCatalog.get(slug);
  if (catalog) return { weapon: catalog, stats: catalog.stats, banMenh: false };
  if (!slug.startsWith(BAN_MENH_SLUG_PREFIX)) return null;
  const tpl = getBanMenhTemplate(discordId);
  const owned = store.userWeapons.query(
    (w) => w.discord_id === discordId && w.weapon_slug === slug,
  )[0];
  const stats = owned?.custom_stats ?? tpl?.stats;
  if (!tpl || !stats) return null;
  return { weapon: tpl, stats, banMenh: true };
}

export function weaponItem(w: Weapon, level: number): ItemView {
  return {
    icon: weaponIcon(w),
    // The grade has its own line on every card, so drop it from the name.
    name: w.display_name
      .replace(/\s*\(Bản Mệnh\)/, '')
      .replace(/\s+(Phàm|Địa|Thiên|Tiên|Thánh|Thần|Huyền) Phẩm$/, ''),
    grade: TIER_NAME[w.tier] ?? w.tier,
    color: TIER_COLOR[w.tier] ?? GREY,
    level,
  };
}

export function congPhapItem(c: CongPhap, level: number): ItemView {
  return {
    icon: congPhapIcon(c),
    name: c.name,
    grade: RARITY_NAME[c.rarity] ?? c.rarity,
    color: RARITY_COLOR[c.rarity] ?? GREY,
    level,
  };
}

export function phapKhiItem(p: PhapKhi, level: number): ItemView {
  return {
    icon: phapKhiIcon(p),
    name: p.name,
    grade: RARITY_NAME[p.rarity] ?? p.rarity,
    color: RARITY_COLOR[p.rarity] ?? GREY,
    level,
  };
}

export function nhanItem(n: Nhan): ItemView {
  return {
    icon: nhanIcon(n),
    name: n.name,
    grade: RARITY_NAME[n.rarity] ?? n.rarity,
    color: RARITY_COLOR[n.rarity] ?? GREY,
    level: 0,
  };
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;

/** Optional bonus boxes shared by công pháp, pháp khí and nhẫn. */
function bonusStats(b: {
  combat_power: number;
  xp_multiplier?: number;
  pill_discount?: number;
  duel_damage_bonus?: number;
}): [string, string, string, string?][] {
  const out: [string, string, string, string?][] = [
    ['LỰC CHIẾN', `+${fmt(b.combat_power)}`, '#f0b84a'],
  ];
  if (b.xp_multiplier) out.push(['TU VI', `+${pct(b.xp_multiplier)}`, '#8fd18a', 'XP nhận được']);
  if (b.pill_discount)
    out.push(['GIẢM GIÁ', `-${pct(b.pill_discount)}`, '#7fb2e8', 'giá đan dược']);
  if (b.duel_damage_bonus)
    out.push(['ĐẤU PHÁP', `+${b.duel_damage_bonus}`, '#e8806e', 'sát thương']);
  return out.slice(0, 4);
}

export function weaponDetail(ref: WeaponRef, level: number): ItemDetail {
  const { weapon: w, stats: s } = ref;
  return {
    ...weaponItem(w, level),
    kindLabel: `${ref.banMenh ? 'Vũ khí bản mệnh' : 'Vũ khí'} · ${CATEGORY_LABEL[w.category] ?? w.category}`,
    sub:
      level > 0
        ? `Cường hóa +${level}: lực chiến vũ khí ×${(1 + level * 0.15).toFixed(2)}`
        : undefined,
    stats: [
      ['SÁT THƯƠNG', `${s.damage_base}`, '#e8806e'],
      ['CHÍ MẠNG', pct(s.crit_chance), '#f0b84a', `×${s.crit_multi} sát thương`],
      s.pierce_count > 0
        ? ['XUYÊN', `${s.pierce_count}`, '#7fb2e8', 'mục tiêu']
        : ['NẢY', `${s.bounce}`, '#7fb2e8', 'khi chạm tường'],
    ],
    lore: w.lore || undefined,
  };
}

export function congPhapDetail(c: CongPhap, level: number): ItemDetail {
  return {
    ...congPhapItem(c, level),
    kindLabel: 'Công pháp',
    sub:
      level > 0 ? `Cường hóa +${level}: lực chiến ×${(1 + level * 0.1).toFixed(1)}` : c.description,
    stats: bonusStats(c.stat_bonuses),
    skill: c.passive_text ? `Nội công: ${c.passive_text}` : undefined,
    lore: c.lore || undefined,
  };
}

export function phapKhiDetail(p: PhapKhi, level: number): ItemDetail {
  return {
    ...phapKhiItem(p, level),
    kindLabel: 'Pháp khí',
    sub:
      level > 0 ? `Cường hóa +${level}: lực chiến ×${(1 + level * 0.1).toFixed(1)}` : p.description,
    stats: bonusStats(p.stat_bonuses),
    skill: p.passive_text ? `Thần thông: ${p.passive_text}` : undefined,
    lore: p.lore || undefined,
  };
}

export function nhanDetail(n: Nhan): ItemDetail {
  return {
    ...nhanItem(n),
    kindLabel: 'Nhẫn',
    sub: n.description,
    stats: bonusStats(n.stat_bonuses),
    lore: n.lore || undefined,
  };
}

export type BagKind = 'cong_phap' | 'weapon' | 'phap_khi' | 'nhan';

export const BAG_TAB_LABEL: Record<BagKind | 'overview', string> = {
  overview: 'Tổng',
  cong_phap: 'Công pháp',
  weapon: 'Vũ khí',
  phap_khi: 'Pháp khí',
  nhan: 'Nhẫn',
};

/** Everything a member owns of one kind (or all kinds), equipped first. */
export function bagItems(discordId: string, kind: BagKind | 'overview'): BagItem[] {
  const store = getStore();
  const user = store.users.get(discordId);
  if (!user) return [];
  const want = (k: BagKind) => kind === 'overview' || kind === k;
  const out: BagItem[] = [];
  if (want('weapon')) {
    for (const o of store.userWeapons.query((w) => w.discord_id === discordId)) {
      const ref = resolveWeapon(discordId, o.weapon_slug);
      if (!ref) continue;
      out.push({
        ...weaponItem(ref.weapon, o.level ?? 0),
        equipped: user.equipped_weapon_slug === o.weapon_slug,
      });
    }
  }
  if (want('cong_phap')) {
    const on = new Set(
      user.equipped_cong_phap_slugs?.length
        ? user.equipped_cong_phap_slugs
        : user.equipped_cong_phap_slug
          ? [user.equipped_cong_phap_slug]
          : [],
    );
    for (const o of store.userCongPhap.query((c) => c.discord_id === discordId)) {
      const c = store.congPhapCatalog.get(o.cong_phap_slug);
      if (c) out.push({ ...congPhapItem(c, o.level ?? 0), equipped: on.has(c.slug) });
    }
  }
  if (want('phap_khi')) {
    for (const o of store.userPhapKhi.query((p) => p.discord_id === discordId)) {
      const p = store.phapKhiCatalog.get(o.phap_khi_slug);
      if (p)
        out.push({
          ...phapKhiItem(p, o.level ?? 0),
          equipped: user.equipped_phap_khi_slug === p.slug,
        });
    }
  }
  if (want('nhan')) {
    const rings = new Set(readEquippedRingSlugs(user));
    for (const o of store.userNhan.query((n) => n.discord_id === discordId)) {
      const n = store.nhanCatalog.get(o.nhan_slug);
      if (n) out.push({ ...nhanItem(n), equipped: rings.has(n.slug) });
    }
  }
  return out
    .sort((a, b) => Number(b.equipped) - Number(a.equipped) || b.level - a.level)
    .slice(0, 30);
}

export function renderBag(discordId: string, kind: BagKind | 'overview'): Promise<Rendered> {
  const user = getStore().users.get(discordId);
  return renderInventoryCard({
    tab: BAG_TAB_LABEL[kind],
    pills: user?.pills ?? 0,
    coins: user?.contribution_points ?? 0,
    items: bagItems(discordId, kind),
  });
}

interface ShopRow {
  view: ItemView;
  slug: string;
  stat: string;
  pills: number;
  coins: number;
  need: CultivationRankId | null;
}

const SHOP_ORDER: Record<ShopItem['state'], number> = {
  equipped: 0,
  owned: 1,
  buy: 2,
  poor: 3,
  locked: 4,
};

function shopRows(discordId: string, kind: BagKind): ShopRow[] {
  const store = getStore();
  const lvl = (rows: { level?: number }[]) => rows[0]?.level ?? 0;
  if (kind === 'weapon')
    return store.weaponCatalog
      .query((w) => w.shop !== null && w.tier !== 'ban_menh')
      .map((w) => ({
        view: weaponItem(
          w,
          lvl(
            store.userWeapons.query((o) => o.discord_id === discordId && o.weapon_slug === w.slug),
          ),
        ),
        slug: w.slug,
        stat: `dmg ${w.stats.damage_base}`,
        pills: w.shop?.cost_pills ?? 0,
        coins: w.shop?.cost_contribution ?? 0,
        need: w.shop?.unlock_realm ?? null,
      }));
  if (kind === 'cong_phap')
    return store.congPhapCatalog
      .query(() => true)
      .map((c) => ({
        view: congPhapItem(
          c,
          lvl(
            store.userCongPhap.query(
              (o) => o.discord_id === discordId && o.cong_phap_slug === c.slug,
            ),
          ),
        ),
        slug: c.slug,
        stat: `+${fmt(c.stat_bonuses.combat_power)} LC`,
        pills: c.cost_pills,
        coins: c.cost_contribution,
        need: c.min_rank_required,
      }));
  if (kind === 'phap_khi')
    return store.phapKhiCatalog
      .query(() => true)
      .map((p) => ({
        view: phapKhiItem(
          p,
          lvl(
            store.userPhapKhi.query(
              (o) => o.discord_id === discordId && o.phap_khi_slug === p.slug,
            ),
          ),
        ),
        slug: p.slug,
        stat: `+${fmt(p.stat_bonuses.combat_power)} LC`,
        pills: p.cost_pills,
        coins: p.cost_contribution,
        need: p.min_rank_required,
      }));
  return store.nhanCatalog
    .query(() => true)
    .map((n) => ({
      view: nhanItem(n),
      slug: n.slug,
      stat: `+${fmt(n.stat_bonuses.combat_power)} LC`,
      pills: n.cost_pills,
      coins: n.cost_contribution,
      need: n.min_rank_required,
    }));
}

/** One tab of the shop: what this member could buy, has, or is locked out of. */
export function renderShop(discordId: string, kind: BagKind): Promise<Rendered> | null {
  const user = getStore().users.get(discordId);
  if (!user) return null;
  const pills = user.pills ?? 0;
  const coins = user.contribution_points ?? 0;
  const owned = new Set(bagSlugs(discordId, kind));
  const equipped = new Set(equippedSlugs(user));
  const ri = rankIndex(user.cultivation_rank);
  const items: ShopItem[] = shopRows(discordId, kind)
    .map((r) => {
      const locked = r.need !== null && rankIndex(r.need) > ri;
      const state: ShopItem['state'] = equipped.has(r.slug)
        ? 'equipped'
        : owned.has(r.slug)
          ? 'owned'
          : locked
            ? 'locked'
            : pills >= r.pills && coins >= r.coins
              ? 'buy'
              : 'poor';
      return {
        ...r.view,
        stat: r.stat,
        pills: r.pills,
        coins: r.coins,
        state,
        need: r.need ? rankById(r.need).name : undefined,
      };
    })
    // First screen: what you have, then the best you can afford now, then
    // the next things to save for; locked items last.
    .sort((a, b) => {
      const d = SHOP_ORDER[a.state] - SHOP_ORDER[b.state];
      if (d !== 0) return d;
      return a.state === 'buy' ? b.coins - a.coins : a.coins - b.coins;
    });
  return renderShopCard({
    tab: BAG_TAB_LABEL[kind],
    rankName: rankById(user.cultivation_rank).name,
    pills,
    coins,
    items,
  });
}

function bagSlugs(discordId: string, kind: BagKind): string[] {
  const store = getStore();
  if (kind === 'weapon')
    return store.userWeapons.query((o) => o.discord_id === discordId).map((o) => o.weapon_slug);
  if (kind === 'cong_phap')
    return store.userCongPhap.query((o) => o.discord_id === discordId).map((o) => o.cong_phap_slug);
  if (kind === 'phap_khi')
    return store.userPhapKhi.query((o) => o.discord_id === discordId).map((o) => o.phap_khi_slug);
  return store.userNhan.query((o) => o.discord_id === discordId).map((o) => o.nhan_slug);
}

function equippedSlugs(user: User): string[] {
  return [
    ...(user.equipped_cong_phap_slugs?.length
      ? user.equipped_cong_phap_slugs
      : user.equipped_cong_phap_slug
        ? [user.equipped_cong_phap_slug]
        : []),
    user.equipped_weapon_slug ?? '',
    user.equipped_phap_khi_slug ?? '',
    ...readEquippedRingSlugs(user),
  ].filter(Boolean);
}

const ELEMENT: Record<string, string> = {
  phong: 'Phong',
  hoa: 'Hỏa',
  thuy: 'Thủy',
  tho: 'Thổ',
  loi: 'Lôi',
  hon: 'Hỗn Nguyên',
};

/** The bản mệnh forge result: template art + this member's own rolled stats. */
export function forgeView(discordId: string, stats: WeaponStats) {
  const tpl = getBanMenhTemplate(discordId);
  const w: Weapon = tpl ?? {
    slug: 'ban-menh',
    display_name: 'Pháp Khí Bản Mệnh',
    category: 'spirit',
    tier: 'ban_menh',
    stats,
    skills: [],
    visual: { model_prefab_key: '', particle_fx_key: '', trail_fx_key: '', hue: '#e8806e' },
    lore: '',
    shop: null,
    created_at: 0,
  };
  const key = w.slug.replace('ban-menh-', '').split('-')[0] ?? '';
  return {
    ...weaponItem(w, 0),
    element: ELEMENT[key] ?? 'Linh',
    stats: [
      ['SÁT THƯƠNG', `${stats.damage_base}`, '#e8806e'],
      ['CHÍ MẠNG', pct(stats.crit_chance), '#f0b84a'],
      stats.pierce_count > 0
        ? ['XUYÊN', `${stats.pierce_count}`, '#7fb2e8']
        : ['NẢY', `${stats.bounce}`, '#7fb2e8'],
    ] as [string, string, string][],
    skill: w.lore || 'Linh khí bản mệnh đang thức tỉnh.',
  };
}

/** One duel side: look, realm, lực chiến and the equipped weapon. */
export function fighterView(discordId: string, name: string, lc: number): Fighter {
  const store = getStore();
  const user = store.users.get(discordId);
  const rank = user?.cultivation_rank ?? 'pham_nhan';
  const slug = user?.equipped_weapon_slug ?? null;
  const ref = slug ? resolveWeapon(discordId, slug) : null;
  const level = slug
    ? (store.userWeapons.query((w) => w.discord_id === discordId && w.weapon_slug === slug)[0]
        ?.level ?? 0)
    : 0;
  return {
    name,
    look: getLook(discordId),
    rankName: rankById(rank).name,
    rankColor: REALM_COLOR[rank] ?? PX.ink,
    lc,
    weapon: ref ? weaponItem(ref.weapon, level) : null,
  };
}

/** A leaderboard row for one member. */
export function boardEntry(user: User, score: string): BoardEntry {
  return {
    name: user.display_name ?? user.username,
    look: getLook(user.discord_id),
    rankName: rankById(user.cultivation_rank).name,
    rankColor: REALM_COLOR[user.cultivation_rank] ?? PX.ink,
    score,
  };
}
