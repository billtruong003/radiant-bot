import type { AvatarLook } from './catalog.js';
import type { ReplyHandle } from './link.js';

/**
 * The web server must tell Discord when a look is saved, but it should not
 * import discord.js code. The Discord side registers a listener here.
 */
type Listener = (
  discordId: string,
  look: AvatarLook,
  reply: ReplyHandle | null,
  expiresAt: number,
) => Promise<void>;
let listener: Listener | null = null;

export function onAvatarSaved(fn: Listener): void {
  listener = fn;
}

export async function notifyAvatarSaved(
  discordId: string,
  look: AvatarLook,
  reply: ReplyHandle | null,
  expiresAt: number,
): Promise<void> {
  try {
    await listener?.(discordId, look, reply, expiresAt);
  } catch {
    // The reply may be gone or expired; the look is saved either way.
  }
}
