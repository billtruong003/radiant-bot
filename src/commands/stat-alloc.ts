import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  ComponentType,
  EmbedBuilder,
  type Message,
  type MessageActionRowComponentBuilder,
  SlashCommandBuilder,
} from 'discord.js';
import { getStore } from '../db/index.js';
import type { User } from '../db/types.js';
import { logger } from '../utils/logger.js';

/**
 * /stat-alloc — Phase 14 stat-point allocation UI.
 *
 * Each level grants the user 2 stat points (per Bill's 2026-05-20 design).
 * Points distribute across 4 categories (dmg/hp/def/spd) via button clicks.
 * Reset is FREE — refunds all spent points into stat_points_unspent.
 *
 * Migration: existing users predating Phase 14 have `stat_points_unspent`
 * undefined. On first /stat-alloc access we lazy-migrate by granting
 * `level × 2` points (back-pay for everything earned before today).
 * `stat_points_granted_for_level` records the last level we paid out for
 * so subsequent level-ups grant incrementally without re-paying.
 *
 * UI: ephemeral embed with current alloc + 5 buttons (+1 each of 4 categories,
 * Reset). Button collector idle-timeouts after 5 min — re-run /stat-alloc
 * to resume.
 */

const POINTS_PER_LEVEL = 2;
const COLLECTOR_TIMEOUT_MS = 5 * 60 * 1000;

type StatKey = 'dmg' | 'hp' | 'def' | 'spd';

const STAT_LABELS: Record<StatKey, { name: string; emoji: string; weight: number }> = {
  dmg: { name: 'Sát thương', emoji: '⚔️', weight: 8 },
  hp: { name: 'Sinh lực', emoji: '❤️', weight: 5 },
  def: { name: 'Phòng ngự', emoji: '🛡️', weight: 3 },
  spd: { name: 'Tốc độ / Chí mạng', emoji: '⚡', weight: 4 },
};

interface AllocState {
  unspent: number;
  alloc: { dmg: number; hp: number; def: number; spd: number };
  /** Level we've already paid points for — used to avoid double-grant. */
  grantedForLevel: number;
}

/**
 * Returns the current allocation state for `user`, applying the lazy
 * migration if needed. Pure: does NOT write to the store — caller persists
 * with `persistAlloc()` when the user clicks a button.
 */
function readAlloc(user: User): AllocState {
  const grantedForLevel = user.stat_points_granted_for_level ?? -1;
  // Lazy migration: if we haven't paid out for the user's current level,
  // back-pay (current_level − granted_for_level) × POINTS_PER_LEVEL.
  // grantedForLevel=-1 (never paid) → back-pay = (level − (-1)) × 2 = (level+1)×2.
  // Adjust: grant points equal to level × POINTS_PER_LEVEL total for first migration.
  const targetGrantedFor = user.level;
  const owed = Math.max(0, (targetGrantedFor - Math.max(grantedForLevel, 0)) * POINTS_PER_LEVEL);

  const alloc = user.stat_alloc ?? { dmg: 0, hp: 0, def: 0, spd: 0 };
  const baseUnspent = user.stat_points_unspent ?? 0;

  return {
    unspent: baseUnspent + owed,
    alloc: { dmg: alloc.dmg, hp: alloc.hp, def: alloc.def, spd: alloc.spd },
    grantedForLevel: targetGrantedFor,
  };
}

async function persistAlloc(discordId: string, state: AllocState): Promise<void> {
  const store = getStore();
  const fresh = store.users.get(discordId);
  if (!fresh) return;
  await store.users.set({
    ...fresh,
    stat_points_unspent: state.unspent,
    stat_alloc: state.alloc,
    stat_points_granted_for_level: state.grantedForLevel,
  });
}

function previewLcBonus(alloc: AllocState['alloc']): number {
  return (
    alloc.dmg * STAT_LABELS.dmg.weight +
    alloc.hp * STAT_LABELS.hp.weight +
    alloc.def * STAT_LABELS.def.weight +
    alloc.spd * STAT_LABELS.spd.weight
  );
}

function buildEmbed(displayName: string, level: number, state: AllocState): EmbedBuilder {
  const totalSpent = state.alloc.dmg + state.alloc.hp + state.alloc.def + state.alloc.spd;
  const lcFromStat = previewLcBonus(state.alloc);

  const statLines = (Object.keys(STAT_LABELS) as StatKey[]).map((k) => {
    const { name, emoji, weight } = STAT_LABELS[k];
    const v = state.alloc[k];
    return `${emoji} **${name}**: \`${v}\` _(+${v * weight} LC)_`;
  });

  return new EmbedBuilder()
    .setColor(0xb09bd3)
    .setTitle('📊 Phân bố chỉ số')
    .setDescription(
      [
        `**${displayName}** _(Lv ${level})_`,
        `🪙 Điểm chưa phân: **${state.unspent}** · Đã phân: **${totalSpent}**`,
        '',
        ...statLines,
        '',
        `**Tổng LC từ chỉ số**: +${lcFromStat}`,
      ].join('\n'),
    )
    .setFooter({
      text: `Mỗi level = ${POINTS_PER_LEVEL} điểm · Reset miễn phí · Timeout sau 5 phút không tương tác`,
    });
}

function buildButtons(state: AllocState, userId: string): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const disabled = state.unspent <= 0;
  const allocRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`statalloc:add:dmg:${userId}`)
      .setEmoji('⚔️')
      .setLabel('+1 DMG')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`statalloc:add:hp:${userId}`)
      .setEmoji('❤️')
      .setLabel('+1 HP')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`statalloc:add:def:${userId}`)
      .setEmoji('🛡️')
      .setLabel('+1 DEF')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`statalloc:add:spd:${userId}`)
      .setEmoji('⚡')
      .setLabel('+1 SPD')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
  const resetRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`statalloc:reset:${userId}`)
      .setEmoji('🔄')
      .setLabel('Reset toàn bộ (free)')
      .setStyle(ButtonStyle.Secondary),
  );
  return [allocRow, resetRow];
}

export const data = new SlashCommandBuilder()
  .setName('stat-alloc')
  .setDescription('Phân bố điểm chỉ số (DMG / HP / DEF / SPD)')
  .setDMPermission(false);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const store = getStore();
  const user = store.users.get(userId);
  if (!user) {
    await interaction.reply({
      content: '🌫️ Bạn chưa có user record — chat vài câu trước.',
      ephemeral: true,
    });
    return;
  }

  let state = readAlloc(user);
  // Persist immediately if migration happened (granted_for_level transitions).
  if ((user.stat_points_granted_for_level ?? -1) !== state.grantedForLevel) {
    await persistAlloc(userId, state);
  }

  const member = await interaction.guild?.members.fetch(userId).catch(() => null);
  const displayName = member?.displayName ?? interaction.user.username;

  const msg = (await interaction.reply({
    embeds: [buildEmbed(displayName, user.level, state)],
    components: buildButtons(state, userId),
    ephemeral: true,
    fetchReply: true,
  })) as Message;

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (i) => i.user.id === userId,
    idle: COLLECTOR_TIMEOUT_MS,
  });

  collector.on('collect', async (btn) => {
    const parts = btn.customId.split(':');
    const action = parts[1];
    try {
      if (action === 'add' && parts[2]) {
        const key = parts[2] as StatKey;
        if (!(key in STAT_LABELS)) {
          await btn.deferUpdate();
          return;
        }
        if (state.unspent <= 0) {
          await btn.reply({ content: 'ℹ️ Hết điểm chưa phân.', ephemeral: true });
          return;
        }
        state = {
          unspent: state.unspent - 1,
          alloc: { ...state.alloc, [key]: state.alloc[key] + 1 },
          grantedForLevel: state.grantedForLevel,
        };
        await persistAlloc(userId, state);
      } else if (action === 'reset') {
        const totalSpent = state.alloc.dmg + state.alloc.hp + state.alloc.def + state.alloc.spd;
        state = {
          unspent: state.unspent + totalSpent,
          alloc: { dmg: 0, hp: 0, def: 0, spd: 0 },
          grantedForLevel: state.grantedForLevel,
        };
        await persistAlloc(userId, state);
      }
      await btn.update({
        embeds: [buildEmbed(displayName, user.level, state)],
        components: buildButtons(state, userId),
      });
    } catch (err) {
      logger.error({ err, userId, customId: btn.customId }, 'stat-alloc: button handler failed');
      try {
        await btn.reply({ content: '⚠️ Lỗi xử lý — thử lại.', ephemeral: true });
      } catch {
        // already-replied edge — ignore
      }
    }
  });

  collector.on('end', async () => {
    // Disable buttons on timeout so the message reads as inert.
    try {
      const disabledRows = buildButtons({ ...state, unspent: 0 }, userId).map((row) => {
        const newRow = new ActionRowBuilder<MessageActionRowComponentBuilder>();
        for (const c of row.components) {
          if (c instanceof ButtonBuilder) newRow.addComponents(c.setDisabled(true));
        }
        return newRow;
      });
      await msg.edit({
        embeds: [buildEmbed(displayName, user.level, state).setFooter({ text: '⏱️ Hết phiên — chạy /stat-alloc lại để tiếp.' })],
        components: disabledRows,
      });
    } catch {
      // ephemeral may have been dismissed — ignore
    }
  });
}

export const command = { data, execute };
export default command;

export const __for_testing = { readAlloc, previewLcBonus, POINTS_PER_LEVEL, STAT_LABELS };
