import {
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  ComponentType,
  EmbedBuilder,
  type Message,
  type MessageActionRowComponentBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { TITLES, getTitle } from '../config/titles.js';
import { getStore } from '../db/index.js';
import { awardEligibleTitles, listOwnedTitleIds } from '../modules/titles/index.js';
import { logger } from '../utils/logger.js';

/**
 * /danh-hieu — Phase 14 honor title management.
 *
 * - First runs awardEligibleTitles so the user sees any newly-qualifying
 *   titles when they invoke the command (catches users whose progress
 *   already met criteria but never had a hook fire — e.g., users who
 *   ranked up before Phase 14 deployed).
 * - Shows owned + locked titles in an embed.
 * - Equip a title via StringSelectMenu (or "—" sentinel option to unequip).
 *
 * Display elsewhere: /stat embed shows the equipped title as a flair line.
 */

const COLLECTOR_TIMEOUT_MS = 5 * 60 * 1000;
const UNEQUIP_VALUE = '__unequip__';

function buildEmbed(userId: string, displayName: string): EmbedBuilder {
  const store = getStore();
  const user = store.users.get(userId);
  const owned = listOwnedTitleIds(userId);
  const equippedId = user?.equipped_title_id ?? null;

  const lines = TITLES.map((t) => {
    if (owned.has(t.id)) {
      const star = t.id === equippedId ? '⭐' : '✅';
      return `${star} ${t.emoji} **${t.name}** — _${t.description}_`;
    }
    return `🔒 ${t.emoji} _${t.name}_ — ${t.description}`;
  });

  const equippedTitle = equippedId ? getTitle(equippedId) : null;
  const headerLine = equippedTitle
    ? `🎖️ Đang trang bị: ${equippedTitle.emoji} **${equippedTitle.name}**`
    : '_(chưa trang bị danh hiệu)_';

  return new EmbedBuilder()
    .setColor(0xf5d76e)
    .setTitle(`🏆 Danh hiệu — ${displayName}`)
    .setDescription([headerLine, '', ...lines].join('\n'))
    .setFooter({
      text: `${owned.size}/${TITLES.length} đã đạt · ⭐ đang đeo · ✅ đã đạt · 🔒 chưa đạt`,
    });
}

function buildSelectRow(
  userId: string,
  ownedIds: Set<string>,
  equippedId: string | null,
): ActionRowBuilder<MessageActionRowComponentBuilder> | null {
  const ownedTitles = TITLES.filter((t) => ownedIds.has(t.id));
  // Always include unequip option so users can clear flair.
  const options: StringSelectMenuOptionBuilder[] = [
    new StringSelectMenuOptionBuilder()
      .setLabel('— Không trang bị —')
      .setValue(UNEQUIP_VALUE)
      .setEmoji('🚫')
      .setDefault(equippedId === null),
  ];
  for (const t of ownedTitles.slice(0, 24)) {
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel(t.name.slice(0, 100))
        .setValue(t.id)
        .setDescription(t.description.slice(0, 100))
        .setEmoji(t.emoji)
        .setDefault(t.id === equippedId),
    );
  }
  if (options.length <= 1) return null; // only the unequip — no titles to pick

  const select = new StringSelectMenuBuilder()
    .setCustomId(`danhhieu:equip:${userId}`)
    .setPlaceholder('Chọn danh hiệu để trang bị')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select);
}

export const data = new SlashCommandBuilder()
  .setName('danh-hieu')
  .setDescription('Danh hiệu (honor title) — xem + trang bị')
  .setDMPermission(false);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const store = getStore();
  if (!store.users.get(userId)) {
    await interaction.reply({
      content: '🌫️ Bạn chưa có user record.',
      ephemeral: true,
    });
    return;
  }

  // Lazy-check: catch users who qualify but never had a hook fire (e.g.,
  // already at Đại Thừa when Phase 14 shipped).
  await awardEligibleTitles(userId);

  const member = await interaction.guild?.members.fetch(userId).catch(() => null);
  const displayName = member?.displayName ?? interaction.user.username;
  const owned = listOwnedTitleIds(userId);
  const equippedId = store.users.get(userId)?.equipped_title_id ?? null;

  const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  const selectRow = buildSelectRow(userId, owned, equippedId);
  if (selectRow) components.push(selectRow);

  const msg = (await interaction.reply({
    embeds: [buildEmbed(userId, displayName)],
    components,
    ephemeral: true,
    fetchReply: true,
  })) as Message;

  if (!selectRow) return; // nothing to equip yet — done

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    filter: (i) => i.user.id === userId,
    idle: COLLECTOR_TIMEOUT_MS,
  });

  collector.on('collect', async (sel) => {
    try {
      const pick = sel.values[0];
      const fresh = store.users.get(userId);
      if (!fresh || !pick) {
        await sel.deferUpdate();
        return;
      }
      const newEquipped = pick === UNEQUIP_VALUE ? null : pick;
      // Verify ownership when equipping a specific title (defense vs spoofed
      // select values).
      if (newEquipped !== null && !listOwnedTitleIds(userId).has(newEquipped)) {
        await sel.reply({ content: '⚠️ Bạn chưa đạt danh hiệu đó.', ephemeral: true });
        return;
      }
      await store.users.set({ ...fresh, equipped_title_id: newEquipped });
      const newOwned = listOwnedTitleIds(userId);
      const rebuiltRow = buildSelectRow(userId, newOwned, newEquipped);
      const rebuiltComponents = rebuiltRow ? [rebuiltRow] : [];
      await sel.update({
        embeds: [buildEmbed(userId, displayName)],
        components: rebuiltComponents,
      });
    } catch (err) {
      logger.error({ err, userId, customId: sel.customId }, 'danh-hieu: handler failed');
      try {
        if (!sel.replied) await sel.deferUpdate();
      } catch {
        // ignore
      }
    }
  });

  collector.on('end', async () => {
    try {
      await msg.edit({
        embeds: [
          buildEmbed(userId, displayName).setFooter({
            text: '⏱️ Hết phiên — chạy /danh-hieu lại để tiếp.',
          }),
        ],
        components: [],
      });
    } catch {
      // ephemeral dismissed — ignore
    }
  });
}

export const command = { data, execute };
export default command;
