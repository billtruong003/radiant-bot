import type { CongPhap, Nhan, PhapKhi, Weapon } from '../../db/types.js';
import { type Ctx, asset, measure, text } from './canvas.js';

/**
 * Item → icon. The art is the CC0 wuxia icon packs (assets/cultivation/icons
 * at 64 px, icons32 at 32 px). Pixel art is only drawn at whole-number scales,
 * so a 64 px icon shows at 64 or 128, never 48.
 */

const TIER_MATERIAL: Record<string, string> = {
  pham: 'rusty_stone',
  dia: 'forged_iron',
  thien: 'icy_frost_steel',
  thanh: 'green_jade',
  than: 'divine_gold_inlaid_wood',
  ban_menh: 'meteoric_lava_iron',
};
const RARITY_MATERIAL: Record<string, string> = {
  common: 'forged_iron',
  uncommon: 'forged_iron',
  rare: 'shining_silver',
  epic: 'green_jade',
  legendary: 'divine_gold_inlaid_wood',
  tien_khi: 'meteoric_lava_iron',
};

/** Word in the weapon's name → icon shape, longest match first. */
const WEAPON_WORDS: [string, string][] = [
  ['đại đao', 'dadao_war_blade'],
  ['đao', 'dao_saber'],
  ['kiếm', 'jian_sword'],
  ['thương', 'spear'],
  ['kích', 'spear'],
  ['côn', 'staff'],
  ['trượng', 'staff'],
  ['tiêu', 'staff'],
  ['chuỳ', 'war_hammer'],
  ['chùy', 'war_hammer'],
  ['phiến', 'iron_fan'],
  ['châu', 'throwing_dart'],
  ['phù', 'iron_fan'],
];
const CATEGORY_SHAPE: Record<string, string> = {
  blunt: 'war_hammer',
  pierce: 'spear',
  spirit: 'iron_fan',
};

export function weaponIcon(w: Pick<Weapon, 'display_name' | 'category' | 'tier'>): string {
  const name = w.display_name.toLowerCase();
  const shape =
    WEAPON_WORDS.find(([word]) => name.includes(word))?.[1] ??
    CATEGORY_SHAPE[w.category] ??
    'jian_sword';
  return `${shape}__${TIER_MATERIAL[w.tier] ?? 'forged_iron'}`;
}

const PHAP_KHI_SHAPE: Record<string, string> = {
  truc: 'staff',
  kiem: 'jian_sword',
  phan: 'iron_fan',
  dinh: 'gold_medicine',
  bao: 'tassel_earring',
  canh: 'tassel_earring',
};
export function phapKhiIcon(p: Pick<PhapKhi, 'type' | 'rarity'>): string {
  return `${PHAP_KHI_SHAPE[p.type] ?? 'tassel_earring'}__${RARITY_MATERIAL[p.rarity] ?? 'forged_iron'}`;
}

const RING_SHAPES = [
  'jade_ring',
  'dragon_ring',
  'lotus_ring',
  'rune_ring',
  'yinyang_ring',
  'signet_ring',
  'bamboo_ring',
  'poison_ring',
];
const RING_WORDS: [string, string][] = [
  ['linh-khi', 'jade_ring'],
  ['hoa', 'dragon_ring'],
  ['bang', 'lotus_ring'],
  ['tinh', 'rune_ring'],
  ['hon-nguyen', 'yinyang_ring'],
  ['van-linh', 'bamboo_ring'],
  ['tram-tien', 'signet_ring'],
  ['thien-dao', 'dragon_ring'],
];
export function nhanIcon(n: Pick<Nhan, 'slug' | 'rarity'>): string {
  let shape = RING_WORDS.find(([w]) => n.slug.includes(w))?.[1];
  if (!shape) {
    let h = 0;
    for (const c of n.slug) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    shape = RING_SHAPES[h % RING_SHAPES.length] ?? 'jade_ring';
  }
  return `${shape}__${RARITY_MATERIAL[n.rarity] ?? 'forged_iron'}`;
}

export function congPhapIcon(c: Pick<CongPhap, 'rarity'>): string {
  if (c.rarity === 'legendary') return 'scroll_thanh';
  if (c.rarity === 'rare' || c.rarity === 'epic') return 'scroll_thien';
  return 'scroll_pham';
}

/** Draws an icon at 32, 64 or 128 px. */
export async function drawIcon(
  ctx: Ctx,
  name: string,
  x: number,
  y: number,
  size: 32 | 64 | 128,
): Promise<void> {
  const img = await asset(`cultivation/${size === 32 ? 'icons32' : 'icons'}/${name}.png`);
  if (size % img.width !== 0)
    throw new Error(`icon ${name} (${img.width}px) cannot be drawn at ${size}px`);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, Math.round(x), Math.round(y), size, size);
  ctx.restore();
}

/** "💊 37  🪙 1,240" with the pixel pill and coin; returns the width. */
export async function money(
  ctx: Ctx,
  x: number,
  y: number,
  pills: string,
  coins: string,
  size = 24,
): Promise<number> {
  await drawIcon(ctx, 'pill32', x, y, 32);
  let cx = x + 38;
  text(ctx, pills, cx, y + (32 - size) / 2, { size });
  cx += measure(ctx, pills, size) + 16;
  await drawIcon(ctx, 'coin', cx, y, 32);
  cx += 38;
  text(ctx, coins, cx, y + (32 - size) / 2, { size });
  return cx + measure(ctx, coins, size) - x;
}
