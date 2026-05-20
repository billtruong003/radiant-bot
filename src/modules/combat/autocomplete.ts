import type { AutocompleteInteraction } from 'discord.js';
import { rankIndex } from '../../config/cultivation.js';
import { getStore } from '../../db/index.js';
import { getBanMenhDisplay, BAN_MENH_SLUG_PREFIX } from './ban-menh-templates.js';

/**
 * Phase 14.4 — shared autocomplete handlers for slug arguments.
 *
 * Phase 14.7 fix (Bill 2026-05-20: "tab upgrade hiển thị hết vũ khí chứ k
 * hiển thị những cái đã sở hữu"): handlers now read `getSubcommand()` and
 * filter to the relevant ownership scope:
 *
 *   info        → catalog (browse mode)
 *   buy         → catalog NOT yet owned + rank-met + affordable
 *   equip       → OWNED only
 *   unequip     → OWNED only
 *   upgrade     → OWNED only (can't upgrade what you don't have)
 *   info-owned  → OWNED only (weapon/phap-khi info shows owned)
 */

interface AutocompleteOption {
  name: string;
  value: string;
}

function matchScore(query: string, name: string, slug: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const n = name.toLowerCase();
  const s = slug.toLowerCase();
  if (n === q || s === q) return 100;
  if (n.startsWith(q) || s.startsWith(q)) return 80;
  if (n.includes(q) || s.includes(q)) return 50;
  return 0;
}

function rankByQuery<T extends { slug: string; name: string }>(
  items: readonly T[],
  query: string,
): T[] {
  if (!query) return [...items];
  return items
    .map((it) => ({ it, score: matchScore(query, it.name, it.slug) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.it);
}

type Scope = 'browse' | 'buyable' | 'owned';

function scopeFromSubcommand(sub: string): Scope {
  switch (sub) {
    case 'info':
      return 'browse';
    case 'buy':
      return 'buyable';
    case 'equip':
    case 'unequip':
    case 'upgrade':
      return 'owned';
    default:
      return 'browse';
  }
}

// ============== Công pháp ==================================================

export async function autocompleteCongPhap(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused().toString();
  const store = getStore();
  const userId = interaction.user.id;
  const sub = interaction.options.getSubcommand(false) ?? 'browse';
  const scope = scopeFromSubcommand(sub);

  const user = store.users.get(userId);
  const ownedSlugs = new Set(
    store.userCongPhap.query((uc) => uc.discord_id === userId).map((uc) => uc.cong_phap_slug),
  );

  let pool: { slug: string; name: string; rarity: string; owned: boolean }[];

  if (scope === 'owned') {
    // Only show items the user owns.
    pool = store.congPhapCatalog
      .query((c) => ownedSlugs.has(c.slug))
      .map((c) => ({ slug: c.slug, name: c.name, rarity: c.rarity, owned: true }));
  } else if (scope === 'buyable' && user) {
    const pills = user.pills ?? 0;
    const contrib = user.contribution_points ?? 0;
    const userRankIdx = rankIndex(user.cultivation_rank);
    pool = store.congPhapCatalog
      .query((c) => {
        if (ownedSlugs.has(c.slug)) return false;
        if (c.min_rank_required && rankIndex(c.min_rank_required) > userRankIdx) return false;
        if (pills < c.cost_pills) return false;
        if (contrib < c.cost_contribution) return false;
        return true;
      })
      .map((c) => ({ slug: c.slug, name: c.name, rarity: c.rarity, owned: false }));
  } else {
    pool = store.congPhapCatalog
      .query(() => true)
      .map((c) => ({ slug: c.slug, name: c.name, rarity: c.rarity, owned: ownedSlugs.has(c.slug) }));
  }

  const ranked = rankByQuery(pool, focused).slice(0, 25);
  const opts: AutocompleteOption[] = ranked.map((it) => ({
    name: `${it.owned && scope === 'browse' ? '✓ ' : ''}${it.name} [${it.rarity}]`.slice(0, 100),
    value: it.slug,
  }));
  await interaction.respond(opts);
}

// ============== Weapon =====================================================

export async function autocompleteWeapon(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused().toString();
  const store = getStore();
  const userId = interaction.user.id;
  const sub = interaction.options.getSubcommand(false) ?? 'browse';
  const scope = scopeFromSubcommand(sub);

  const owned = store.userWeapons.query((w) => w.discord_id === userId);
  const ownedSlugs = new Set(owned.map((w) => w.weapon_slug));

  let pool: { slug: string; name: string; tier: string; owned: boolean }[];

  if (scope === 'owned') {
    // Owned catalog refs + bản mệnh forged weapons.
    pool = [];
    for (const w of owned) {
      const catalog = store.weaponCatalog.get(w.weapon_slug);
      if (catalog) {
        pool.push({
          slug: w.weapon_slug,
          name: catalog.display_name,
          tier: catalog.tier,
          owned: true,
        });
      } else if (w.weapon_slug.startsWith(BAN_MENH_SLUG_PREFIX)) {
        const display = getBanMenhDisplay(userId);
        pool.push({
          slug: w.weapon_slug,
          name: display.name,
          tier: 'ban_menh',
          owned: true,
        });
      }
    }
  } else if (scope === 'buyable' && store.users.get(userId)) {
    const user = store.users.get(userId);
    if (!user) {
      pool = [];
    } else {
      const pills = user.pills ?? 0;
      const contrib = user.contribution_points ?? 0;
      const userRankIdx = rankIndex(user.cultivation_rank);
      pool = store.weaponCatalog
        .query((w) => {
          if (!w.shop) return false;
          if (ownedSlugs.has(w.slug)) return false;
          if (w.shop.unlock_realm && rankIndex(w.shop.unlock_realm) > userRankIdx) return false;
          if (pills < w.shop.cost_pills) return false;
          if (contrib < w.shop.cost_contribution) return false;
          return true;
        })
        .map((w) => ({
          slug: w.slug,
          name: w.display_name,
          tier: w.tier,
          owned: false,
        }));
    }
  } else {
    // browse — full catalog + ownership marker
    pool = store.weaponCatalog
      .query(() => true)
      .map((w) => ({
        slug: w.slug,
        name: w.display_name,
        tier: w.tier,
        owned: ownedSlugs.has(w.slug),
      }));
  }

  const ranked = rankByQuery(pool, focused).slice(0, 25);
  const opts: AutocompleteOption[] = ranked.map((it) => ({
    name: `${it.owned && scope === 'browse' ? '✓ ' : ''}${it.name} [${it.tier}]`.slice(0, 100),
    value: it.slug,
  }));
  await interaction.respond(opts);
}

// ============== Pháp khí ===================================================

export async function autocompletePhapKhi(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused().toString();
  const store = getStore();
  const userId = interaction.user.id;
  const sub = interaction.options.getSubcommand(false) ?? 'browse';
  const scope = scopeFromSubcommand(sub);

  const ownedSlugs = new Set(
    store.userPhapKhi.query((u) => u.discord_id === userId).map((u) => u.phap_khi_slug),
  );

  let pool: { slug: string; name: string; rarity: string; owned: boolean }[];

  if (scope === 'owned') {
    pool = store.phapKhiCatalog
      .query((p) => ownedSlugs.has(p.slug))
      .map((p) => ({ slug: p.slug, name: p.name, rarity: p.rarity, owned: true }));
  } else if (scope === 'buyable') {
    const user = store.users.get(userId);
    if (!user) {
      pool = [];
    } else {
      const pills = user.pills ?? 0;
      const contrib = user.contribution_points ?? 0;
      const userRankIdx = rankIndex(user.cultivation_rank);
      pool = store.phapKhiCatalog
        .query((p) => {
          if (ownedSlugs.has(p.slug)) return false;
          if (p.min_rank_required && rankIndex(p.min_rank_required) > userRankIdx) return false;
          if (pills < p.cost_pills) return false;
          if (contrib < p.cost_contribution) return false;
          return true;
        })
        .map((p) => ({ slug: p.slug, name: p.name, rarity: p.rarity, owned: false }));
    }
  } else {
    pool = store.phapKhiCatalog
      .query(() => true)
      .map((p) => ({ slug: p.slug, name: p.name, rarity: p.rarity, owned: ownedSlugs.has(p.slug) }));
  }

  const ranked = rankByQuery(pool, focused).slice(0, 25);
  const opts: AutocompleteOption[] = ranked.map((it) => ({
    name: `${it.owned && scope === 'browse' ? '✓ ' : ''}${it.name} [${it.rarity}]`.slice(0, 100),
    value: it.slug,
  }));
  await interaction.respond(opts);
}

// ============== Nhẫn =======================================================

export async function autocompleteNhan(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused().toString();
  const store = getStore();
  const userId = interaction.user.id;
  const sub = interaction.options.getSubcommand(false) ?? 'browse';
  const scope = scopeFromSubcommand(sub);

  const ownedSlugs = new Set(
    store.userNhan.query((u) => u.discord_id === userId).map((u) => u.nhan_slug),
  );

  let pool: { slug: string; name: string; rarity: string; owned: boolean }[];

  if (scope === 'owned') {
    pool = store.nhanCatalog
      .query((n) => ownedSlugs.has(n.slug))
      .map((n) => ({ slug: n.slug, name: n.name, rarity: n.rarity, owned: true }));
  } else if (scope === 'buyable') {
    const user = store.users.get(userId);
    if (!user) {
      pool = [];
    } else {
      const pills = user.pills ?? 0;
      const contrib = user.contribution_points ?? 0;
      const userRankIdx = rankIndex(user.cultivation_rank);
      pool = store.nhanCatalog
        .query((n) => {
          if (ownedSlugs.has(n.slug)) return false;
          if (n.min_rank_required && rankIndex(n.min_rank_required) > userRankIdx) return false;
          if (pills < n.cost_pills) return false;
          if (contrib < n.cost_contribution) return false;
          return true;
        })
        .map((n) => ({ slug: n.slug, name: n.name, rarity: n.rarity, owned: false }));
    }
  } else {
    pool = store.nhanCatalog
      .query(() => true)
      .map((n) => ({ slug: n.slug, name: n.name, rarity: n.rarity, owned: ownedSlugs.has(n.slug) }));
  }

  const ranked = rankByQuery(pool, focused).slice(0, 25);
  const opts: AutocompleteOption[] = ranked.map((it) => ({
    name: `${it.owned && scope === 'browse' ? '✓ ' : ''}${it.name} [${it.rarity}]`.slice(0, 100),
    value: it.slug,
  }));
  await interaction.respond(opts);
}
