import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type MessageActionRowComponentBuilder,
} from 'discord.js';

/**
 * Discord StringSelectMenu hard limit. Callers must slice to ≤ this per page;
 * any more silently truncates and the extra items become unreachable from the
 * dropdown (Bill 2026-06-02: 31 weapons → top 25 only, last 6 invisible).
 */
export const SELECT_PAGE_SIZE = 25;

export interface PageSlice<T> {
  slice: T[];
  pageIdx: number;
  totalPages: number;
}

/**
 * Slice items into a single page bounded by SELECT_PAGE_SIZE. Returns a
 * clamped pageIdx so callers can safely store an out-of-bounds page index
 * (e.g. after equipping an item that shrinks the list, or after a tab
 * switch where the new tab has fewer pages).
 */
export function pageOf<T>(items: readonly T[], requestedPage: number): PageSlice<T> {
  const totalPages = Math.max(1, Math.ceil(items.length / SELECT_PAGE_SIZE));
  const pageIdx = Math.min(Math.max(0, requestedPage), totalPages - 1);
  const start = pageIdx * SELECT_PAGE_SIZE;
  return { slice: items.slice(start, start + SELECT_PAGE_SIZE), pageIdx, totalPages };
}

/**
 * Three-button nav row: ◀ prev · "Trang N/M" (disabled label) · next ▶.
 * Returns null when pagination is unnecessary (1 page) so callers can
 * conditionally append. The middle button's customId never fires (Discord
 * skips disabled buttons), so it doesn't need handler routing.
 *
 * customIdBase is prefixed onto `:prev` / `:noop` / `:next` — pick a base
 * unique to the active context, e.g. `inv:page:weapon:<userId>`.
 */
export function buildPageNavRow(
  customIdBase: string,
  pageIdx: number,
  totalPages: number,
): ActionRowBuilder<MessageActionRowComponentBuilder> | null {
  if (totalPages <= 1) return null;
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${customIdBase}:prev`)
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pageIdx === 0),
    new ButtonBuilder()
      .setCustomId(`${customIdBase}:noop`)
      .setLabel(`Trang ${pageIdx + 1}/${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`${customIdBase}:next`)
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pageIdx >= totalPages - 1),
  );
}
