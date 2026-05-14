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
import { rankById } from '../config/cultivation.js';
import { getStore } from '../db/index.js';
import { simulateDuel } from '../modules/combat/duel.js';
import { logger } from '../utils/logger.js';

/**
 * /duel @opponent [stake=1] — Phase 12 Lát 6 PvP combat with accept window.
 *
 * Flow:
 *   1. Caller invokes /duel @opponent [stake] — public message with
 *      "✅ Accept / ❌ Decline" buttons + 60s collector.
 *   2. Opponent (only they can press) clicks accept → simulate 5 rounds,
 *      edit message to show result + transfer stake.
 *   3. Opponent declines OR timeout → edit message to show "declined" /
 *      "timeout", refund any held state.
 *
 * Both fighters must have ≥ stake pills at challenge time. Pills are
 * NOT escrowed up-front — only deducted at settlement. Edge case: if
 * either user spends pills between challenge + accept, settlement uses
 * Math.max(0, pills - delta) so neither account goes negative.
 *
 * Cooldown + daily cap applied at challenge time (not at accept).
 */

const DUEL_COOLDOWN_MS = 30 * 60 * 1000;
const DUELS_PER_DAY_MAX = 3;
const ACCEPT_WINDOW_MS = 60_000;

interface DuelMetadata {
  lastDuelAt: number;
  duelsToday: number;
  todayStart: number;
}

const duelMetadata: Map<string, DuelMetadata> = new Map();

function getMeta(userId: string, now: number): DuelMetadata {
  const dayStart = now - (now % (24 * 60 * 60 * 1000));
  const existing = duelMetadata.get(userId);
  if (!existing || existing.todayStart !== dayStart) {
    return { lastDuelAt: 0, duelsToday: 0, todayStart: dayStart };
  }
  return existing;
}

export const data = new SlashCommandBuilder()
  .setName('duel')
  .setDescription('Đấu PvP với đệ tử khác (5 hiệp, thắng lấy stake đan dược)')
  .setDMPermission(false)
  .addUserOption((opt) => opt.setName('opponent').setDescription('Đối thủ').setRequired(true))
  .addIntegerOption((opt) =>
    opt
      .setName('stake')
      .setDescription('Stake đan dược (mặc định 1, max 10)')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(10),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const challenger = interaction.user;
  const opponent = interaction.options.getUser('opponent', true);
  const stake = interaction.options.getInteger('stake') ?? 1;
  const now = Date.now();

  if (opponent.id === challenger.id) {
    await interaction.reply({
      content: '⚔️ Không thể đấu với chính mình. Tìm đối thủ khác nha.',
      ephemeral: true,
    });
    return;
  }
  if (opponent.bot) {
    await interaction.reply({ content: '⚔️ Bot không tham gia duel.', ephemeral: true });
    return;
  }

  const store = getStore();
  const cUser = store.users.get(challenger.id);
  const oUser = store.users.get(opponent.id);
  if (!cUser) {
    await interaction.reply({
      content: '🌫️ Bạn chưa có user record. Chat vài câu trước.',
      ephemeral: true,
    });
    return;
  }
  if (!oUser) {
    await interaction.reply({
      content: `🌫️ ${opponent.username} chưa có user record — chưa từng chat.`,
      ephemeral: true,
    });
    return;
  }

  const cMeta = getMeta(challenger.id, now);
  if (now - cMeta.lastDuelAt < DUEL_COOLDOWN_MS) {
    const remainingMin = Math.ceil((DUEL_COOLDOWN_MS - (now - cMeta.lastDuelAt)) / 60_000);
    await interaction.reply({
      content: `⏱️ Đợi ${remainingMin} phút nữa mới được duel tiếp.`,
      ephemeral: true,
    });
    return;
  }
  if (cMeta.duelsToday >= DUELS_PER_DAY_MAX) {
    await interaction.reply({
      content: `⏱️ Bạn đã duel ${DUELS_PER_DAY_MAX} lần hôm nay rồi. Quay lại ngày mai.`,
      ephemeral: true,
    });
    return;
  }

  const cPills = cUser.pills ?? 0;
  const oPills = oUser.pills ?? 0;
  if (cPills < stake) {
    await interaction.reply({
      content: `💊 Bạn cần ${stake} đan dược để duel (hiện có ${cPills}).`,
      ephemeral: true,
    });
    return;
  }
  if (oPills < stake) {
    await interaction.reply({
      content: `💊 ${opponent.username} không đủ ${stake} đan dược cho stake này.`,
      ephemeral: true,
    });
    return;
  }

  // Challenge embed with accept/decline buttons. Public message so
  // spectators see the throw-down.
  const cRank = rankById(cUser.cultivation_rank).name;
  const oRank = rankById(oUser.cultivation_rank).name;

  const challengeEmbed = new EmbedBuilder()
    .setColor(0xb09bd3)
    .setTitle('⚔️ Lời thách đấu')
    .setDescription(
      [
        `**${challenger.username}** (${cRank}) thách đấu **${opponent.username}** (${oRank}).`,
        `Stake: 💊 ${stake} đan dược`,
        '',
        `${opponent} có **60 giây** để chấp nhận hoặc từ chối.`,
      ].join('\n'),
    )
    .setFooter({ text: 'Chỉ đối thủ được bấm. Caller không tự accept giùm.' });

  const acceptBtn = new ButtonBuilder()
    .setCustomId(`duel:accept:${challenger.id}:${opponent.id}:${stake}`)
    .setLabel('Chấp nhận')
    .setEmoji('✅')
    .setStyle(ButtonStyle.Success);
  const declineBtn = new ButtonBuilder()
    .setCustomId(`duel:decline:${challenger.id}:${opponent.id}:${stake}`)
    .setLabel('Từ chối')
    .setEmoji('❌')
    .setStyle(ButtonStyle.Secondary);
  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    acceptBtn,
    declineBtn,
  );

  const challengeMsg = (await interaction.reply({
    content: `${opponent}, ${challenger} thách đấu bạn!`,
    embeds: [challengeEmbed],
    components: [row],
    allowedMentions: { users: [opponent.id] },
    fetchReply: true,
  })) as Message;

  try {
    const click = await challengeMsg.awaitMessageComponent({
      filter: (i) => i.user.id === opponent.id,
      componentType: ComponentType.Button,
      time: ACCEPT_WINDOW_MS,
    });

    if (click.customId.startsWith('duel:decline:')) {
      await click.update({
        content: `❌ ${opponent.username} đã từ chối lời thách đấu của ${challenger.username}.`,
        embeds: [],
        components: [],
      });
      return;
    }

    // Accept path — re-validate state in case currency changed.
    const cUserNow = store.users.get(challenger.id);
    const oUserNow = store.users.get(opponent.id);
    if (!cUserNow || !oUserNow) {
      await click.update({
        content: '⚠️ User record vanished mid-duel — abort.',
        embeds: [],
        components: [],
      });
      return;
    }
    if ((cUserNow.pills ?? 0) < stake || (oUserNow.pills ?? 0) < stake) {
      await click.update({
        content: '💊 Một bên đã tiêu đan dược trong thời gian chờ — duel bị huỷ.',
        embeds: [],
        components: [],
      });
      return;
    }

    const cEquipped = cUserNow.equipped_cong_phap_slug
      ? (store.congPhapCatalog.get(cUserNow.equipped_cong_phap_slug) ?? null)
      : null;
    const oEquipped = oUserNow.equipped_cong_phap_slug
      ? (store.congPhapCatalog.get(oUserNow.equipped_cong_phap_slug) ?? null)
      : null;

    const result = simulateDuel(
      { user: cUserNow, displayName: challenger.username, equippedCongPhap: cEquipped },
      { user: oUserNow, displayName: opponent.username, equippedCongPhap: oEquipped },
      Date.now() & 0xffffffff,
    );

    const cDelta = result.winner === 'challenger' ? stake : -stake;
    const oDelta = result.winner === 'opponent' ? stake : -stake;
    await store.users.set({
      ...cUserNow,
      pills: Math.max(0, (cUserNow.pills ?? 0) + cDelta),
    });
    await store.users.set({
      ...oUserNow,
      pills: Math.max(0, (oUserNow.pills ?? 0) + oDelta),
    });

    duelMetadata.set(challenger.id, {
      lastDuelAt: Date.now(),
      duelsToday: cMeta.duelsToday + 1,
      todayStart: cMeta.todayStart,
    });

    const winnerName =
      result.winner === 'challenger'
        ? challenger.username
        : result.winner === 'opponent'
          ? opponent.username
          : 'Hòa';
    const winnerEmoji = result.winner === 'tie' ? '🤝' : '🏆';

    const roundLines = result.rounds.map((r) => {
      const cMark = r.challengerCrit ? '⚡' : r.challengerDefended ? '🛡️' : '⚔️';
      const oMark = r.opponentCrit ? '⚡' : r.opponentDefended ? '🛡️' : '⚔️';
      return `**Hiệp ${r.round}:** ${cMark} ${challenger.username} −${r.opponentDamage} · ${oMark} ${opponent.username} −${r.challengerDamage}   _(${r.challengerHpAfter} vs ${r.opponentHpAfter})_`;
    });

    const resultEmbed = new EmbedBuilder()
      .setColor(
        result.winner === 'challenger'
          ? 0x2ecc71
          : result.winner === 'opponent'
            ? 0xe74c3c
            : 0x95a5a6,
      )
      .setTitle(`⚔️ Duel: ${challenger.username} vs ${opponent.username}`)
      .setDescription(
        [
          `**${challenger.username}** (${cRank} · ${result.challengerLc} LC) ⚔️ **${opponent.username}** (${oRank} · ${result.opponentLc} LC)`,
          `Stake: 💊 ${stake} đan dược`,
          '',
          ...roundLines,
          '',
          `${winnerEmoji} **Thắng: ${winnerName}**`,
          `HP cuối: ${challenger.username} ${result.challengerHpEnd} / ${opponent.username} ${result.opponentHpEnd}`,
          result.winner === 'challenger'
            ? `${challenger.username} +${stake} 💊 · ${opponent.username} −${stake} 💊`
            : result.winner === 'opponent'
              ? `${opponent.username} +${stake} 💊 · ${challenger.username} −${stake} 💊`
              : 'Hoà — không ai mất đan dược.',
        ].join('\n'),
      )
      .setFooter({ text: '⚔️ tấn công · 🛡️ thủ · ⚡ chí mạng · Phase 12' });

    await click.update({ content: '', embeds: [resultEmbed], components: [] });

    logger.info(
      {
        challenger: challenger.id,
        opponent: opponent.id,
        stake,
        winner: result.winner,
        c_lc: result.challengerLc,
        o_lc: result.opponentLc,
      },
      'duel: settled',
    );
  } catch (err) {
    // Timeout — opponent never clicked. Discord throws on collector timeout.
    const isTimeout = (err as { code?: string })?.code === 'InteractionCollectorError';
    try {
      await challengeMsg.edit({
        content: isTimeout
          ? `⏱️ ${opponent.username} không phản hồi trong 60 giây — duel bị huỷ.`
          : '⚠️ Lỗi khi xử lý duel.',
        embeds: [],
        components: [],
      });
    } catch {
      // Message gone — ignore.
    }
    if (!isTimeout) {
      logger.error({ err, challenger: challenger.id, opponent: opponent.id }, 'duel: failed');
    }
  }
}

export const __for_testing = { duelMetadata, DUEL_COOLDOWN_MS, DUELS_PER_DAY_MAX };

export const command = { data, execute };
export default command;
