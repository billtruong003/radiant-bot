import { getStore } from '../../db/index.js';
import type { CultivationRankId } from '../../db/types.js';
import { type AvatarLook, LAYER_KEYS } from './catalog.js';

/** Reads and writes a member's look. Validation happens in the caller (catalog.validateLook). */

export function getLook(discordId: string): AvatarLook | null {
  const a = getStore().avatars.get(discordId);
  if (!a) return null;
  const look = {} as AvatarLook;
  for (const k of LAYER_KEYS) look[k] = a[k];
  return look;
}

export async function saveLook(
  discordId: string,
  look: AvatarLook,
  now = Date.now(),
): Promise<void> {
  await getStore().avatars.set({ discord_id: discordId, ...look, updated_at: now });
}

export function rankOf(discordId: string): CultivationRankId {
  return getStore().users.get(discordId)?.cultivation_rank ?? 'pham_nhan';
}
