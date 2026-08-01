import { createHash } from 'node:crypto';
import { getStore } from '../../db/index.js';
import type { Weapon } from '../../db/types.js';

/**
 * Phase 14.7 — Bill 2026-05-20: "k hiểu cơ chế bản mệnh có vũ khí Hoả Tâm
 * Kiếm vv nhưng khi forge ra cái Pháp Khí Bản Mệnh generic".
 *
 * The 6 bản mệnh templates we shipped in `weapon-catalog.json` (Phong Linh
 * Côn, Hoả Tâm Kiếm, Thuỷ Tâm Châu, Thổ Cương Bang, Lôi Nha Thương, Hỗn
 * Nguyên Linh) were sitting in the catalog unused — forge.ts generated a
 * generic "Bản Mệnh Khí" with custom stats instead of picking one.
 *
 * This module bridges the two: a deterministic hash of discord_id picks
 * 1 of the 6 templates. Read-only — does NOT mutate forge.ts (existing
 * UserWeapon records keep their custom_stats slug). Display layer calls
 * `getBanMenhDisplay(discordId)` to get the themed name + icon + lore
 * instead of "Bản Mệnh Khí".
 *
 * Mapping uses SHA-256 byte 0 mod 6 — independent of the bytes forge.ts
 * uses for stats (bytes 0-6) so re-design is decoupled. Same disco_id
 * always maps to same template (idempotent).
 */

export const BAN_MENH_SLUG_PREFIX = 'phap-khi-ban-menh-';

export const BAN_MENH_TEMPLATE_SLUGS: readonly string[] = [
  'ban-menh-phong-linh-con',
  'ban-menh-hoa-tam-kiem',
  'ban-menh-thuy-tam-chau',
  'ban-menh-tho-cuong-bang',
  'ban-menh-loi-nha-thuong',
  'ban-menh-hon-nguyen-linh',
];

/**
 * Deterministically pick one of the 6 bản mệnh template slugs for a user.
 * Idempotent: same discord_id → same template.
 */
export function getBanMenhTemplateSlug(discordId: string): string {
  const hash = createHash('sha256').update(discordId).digest();
  const idx = hash.readUInt8(0) % BAN_MENH_TEMPLATE_SLUGS.length;
  const slug = BAN_MENH_TEMPLATE_SLUGS[idx];
  if (!slug) throw new Error(`bản mệnh template index out of range: ${idx}`);
  return slug;
}

/**
 * Resolve the catalog template a user's bản mệnh maps to. Returns the
 * full Weapon entry (with stats, lore, icon) from `weaponCatalog`.
 *
 * Used by display paths in /weapon list/info, /inventory, /shop, /stat,
 * and autocomplete so users see the themed name ("Hoả Tâm Kiếm") instead
 * of the generic "Bản Mệnh Khí" slug-prefix string.
 */
export function getBanMenhTemplate(discordId: string): Weapon | null {
  const slug = getBanMenhTemplateSlug(discordId);
  return getStore().weaponCatalog.get(slug) ?? null;
}

/**
 * Compact display tuple. Returns sane fallback if catalog lookup fails
 * (e.g., catalog not yet seeded — unlikely in production but happens
 * in tests).
 */
export function getBanMenhDisplay(discordId: string): {
  slug: string;
  name: string;
  icon: string;
  lore: string;
} {
  const tpl = getBanMenhTemplate(discordId);
  if (tpl) {
    return {
      slug: tpl.slug,
      name: tpl.display_name,
      icon: '🔮',
      lore: tpl.lore,
    };
  }
  return {
    slug: getBanMenhTemplateSlug(discordId),
    name: 'Bản Mệnh Khí',
    icon: '🔮',
    lore: 'Vũ khí bản mệnh — khí sinh ra cùng tu sĩ, biến hoá theo tâm.',
  };
}
