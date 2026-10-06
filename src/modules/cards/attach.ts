import { AttachmentBuilder, type EmbedBuilder } from 'discord.js';
import type { Rendered } from '../pixel/output.js';

/**
 * Puts a rendered card inside an embed. The image shows under the embed's
 * text; the text stays for screen readers and when images are off.
 */
export function withCard(embed: EmbedBuilder, card: Rendered | null) {
  if (!card) return { embeds: [embed], files: [] as AttachmentBuilder[] };
  embed.setThumbnail(null).setImage(`attachment://${card.name}`);
  return { embeds: [embed], files: [new AttachmentBuilder(card.buffer, { name: card.name })] };
}

/** Same, for edits and button updates: also drops the previous attachment. */
export function withCardEdit(embed: EmbedBuilder, card: Rendered | null) {
  return { ...withCard(embed, card), attachments: [] };
}
