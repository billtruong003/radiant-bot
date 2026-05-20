import type { AutocompleteInteraction } from 'discord.js';
import { getStore } from '../../db/index.js';

/**
 * Phase 14.4 — shared autocomplete handlers for slug arguments.
 *
 * Every command that takes a `slug` (buy/equip/upgrade/info) now uses
 * Discord's native autocomplete to surface item names instead of forcing
 * the user to memorize kebab-case slugs. Each handler scans the
 * relevant catalog + ownership, ranks by partial-match + relevance, and
 * returns up to 25 results (Discord's max).
 *
 * Filter strategy:
 *   - if `focused` is empty → return top 25 by rarity desc
 *   - else → substring match on name OR slug, prefix-priority
 *
 * Callers wire via `data.addStringOption(o => o.setAutocomplete(true))`
 * + an `autocomplete()` export on the command module.
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

export async function autocompleteCongPhap(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused().toString();
  const store = getStore();
  const all = store.congPhapCatalog
    .query(() => true)
    .map((c) => ({ slug: c.slug, name: c.name, rarity: c.rarity }));
  const ranked = rankByQuery(all, focused).slice(0, 25);
  const opts: AutocompleteOption[] = ranked.map((it) => ({
    name: `${it.name} [${it.rarity}]`.slice(0, 100),
    value: it.slug,
  }));
  await interaction.respond(opts);
}

export async function autocompleteWeapon(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused().toString();
  const store = getStore();
  const userId = interaction.user.id;
  // For weapon, scope to OWNED + catalog. Bản mệnh ownership shows as
  // "Bản Mệnh Khí" via custom_stats fallback.
  const owned = store.userWeapons.query((w) => w.discord_id === userId);
  const ownedSlugs = new Set(owned.map((w) => w.weapon_slug));
  const catalog = store.weaponCatalog.query(() => true);
  const combined = catalog.map((w) => ({
    slug: w.slug,
    name: w.display_name,
    tier: w.tier,
    owned: ownedSlugs.has(w.slug),
  }));
  // Add bản mệnh forged weapons not in catalog
  for (const w of owned) {
    if (!catalog.some((c) => c.slug === w.weapon_slug)) {
      combined.push({
        slug: w.weapon_slug,
        name: 'Bản Mệnh Khí',
        tier: 'ban_menh',
        owned: true,
      });
    }
  }
  const ranked = rankByQuery(combined, focused).slice(0, 25);
  const opts: AutocompleteOption[] = ranked.map((it) => ({
    name: `${it.name} [${it.tier}]${it.owned ? ' ✓' : ''}`.slice(0, 100),
    value: it.slug,
  }));
  await interaction.respond(opts);
}

export async function autocompletePhapKhi(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused().toString();
  const store = getStore();
  const all = store.phapKhiCatalog
    .query(() => true)
    .map((p) => ({ slug: p.slug, name: p.name, rarity: p.rarity }));
  const ranked = rankByQuery(all, focused).slice(0, 25);
  const opts: AutocompleteOption[] = ranked.map((it) => ({
    name: `${it.name} [${it.rarity}]`.slice(0, 100),
    value: it.slug,
  }));
  await interaction.respond(opts);
}

export async function autocompleteNhan(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused().toString();
  const store = getStore();
  const all = store.nhanCatalog
    .query(() => true)
    .map((n) => ({ slug: n.slug, name: n.name, rarity: n.rarity }));
  const ranked = rankByQuery(all, focused).slice(0, 25);
  const opts: AutocompleteOption[] = ranked.map((it) => ({
    name: `${it.name} [${it.rarity}]`.slice(0, 100),
    value: it.slug,
  }));
  await interaction.respond(opts);
}
