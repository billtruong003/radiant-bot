import { type ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { rankById } from '../config/cultivation.js';
import { getStore } from '../db/index.js';
import { simulateDuel } from '../modules/combat/duel.js';
import { logger } from '../utils/logger.js';

/**
 * /duel @opponent [stake=1] — Phase 12 Lát 6 PvP combat.
 *
 * Simplified flow (no interactive accept window for v1):
 *   - Caller picks opponent + stake (1-10 pills)
 *   - Both fighters must have ≥ stake pills
 *   - Simulate 5 rounds, post result embed
 *   - Winner: +stake×2 pills (winner & loser delta together = 0 net,
 *     stake transfers)
 *   - Per-user 30min cooldown, max 3 duels/day, enforced via in-memory map
 *
 * Future v2: button-based accept flow + per-round move selection.
 */

const DUEL_COOLDOWN_MS = 30 * 60 * 1000;
const DUELS_PER_DAY_MAX = 3;

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

  // Cooldown + daily cap for challenger.
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

  // Stake check.
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

  const cEquipped = cUser.equipped_cong_phap_slug
    ? (store.congPhapCatalog.get(cUser.equipped_cong_phap_slug) ?? null)
    : null;
  const oEquipped = oUser.equipped_cong_phap_slug
    ? (store.congPhapCatalog.get(oUser.equipped_cong_phap_slug) ?? null)
    : null;

  const result = simulateDuel(
    {
      user: cUser,
      displayName:
        interaction.member && 'displayName' in interaction.member
          ? (interaction.member as { displayName: string }).displayName
          : challenger.username,
      equippedCongPhap: cEquipped,
    },
    {
      user: oUser,
      displayName: opponent.username,
      equippedCongPhap: oEquipped,
    },
    now & 0xffffffff,
  );

  // Settle stake atomically.
  const cDelta = result.winner === 'challenger' ? stake : -stake;
  const oDelta = result.winner === 'opponent' ? stake : -stake;
  await store.users.set({ ...cUser, pills: Math.max(0, cPills + cDelta) });
  await store.users.set({ ...oUser, pills: Math.max(0, oPills + oDelta) });

  // Update meta.
  duelMetadata.set(challenger.id, {
    lastDuelAt: now,
    duelsToday: cMeta.duelsToday + 1,
    todayStart: cMeta.todayStart,
  });

  logger.info(
    {
      challenger: challenger.id,
      opponent: opponent.id,
      stake,
      winner: result.winner,
      c_lc: result.challengerLc,
      o_lc: result.opponentLc,
      rounds: result.rounds.length,
    },
    'duel: settled',
  );

  // Build narrative embed.
  const cName = challenger.username;
  const oName = opponent.username;
  const winnerName =
    result.winner === 'challenger' ? cName : result.winner === 'opponent' ? oName : 'Hòa';
  const winnerEmoji =
    result.winner === 'challenger' ? '🏆' : result.winner === 'opponent' ? '🏆' : '🤝';

  const roundLines = result.rounds.map((r) => {
    const cMark = r.challengerCrit ? '⚡' : r.challengerDefended ? '🛡️' : '⚔️';
    const oMark = r.opponentCrit ? '⚡' : r.opponentDefended ? '🛡️' : '⚔️';
    return `**Hiệp ${r.round}:** ${cMark} ${cName} −${r.opponentDamage} HP · ${oMark} ${oName} −${r.challengerDamage} HP   _(${r.challengerHpAfter} vs ${r.opponentHpAfter})_`;
  });

  const cRank = rankById(cUser.cultivation_rank).name;
  const oRank = rankById(oUser.cultivation_rank).name;

  const embed = new EmbedBuilder()
    .setColor(
      result.winner === 'challenger'
        ? 0x2ecc71
        : result.winner === 'opponent'
          ? 0xe74c3c
          : 0x95a5a6,
    )
    .setTitle(`⚔️ Duel: ${cName} vs ${oName}`)
    .setDescription(
      [
        `**${cName}** (${cRank} · ${result.challengerLc} LC) ⚔️ **${oName}** (${oRank} · ${result.opponentLc} LC)`,
        `Stake: 💊 ${stake} đan dược`,
        '',
        ...roundLines,
        '',
        `${winnerEmoji} **Thắng: ${winnerName}**`,
        `HP cuối: ${cName} ${result.challengerHpEnd} / ${oName} ${result.opponentHpEnd}`,
        result.winner === 'challenger'
          ? `${cName} +${stake} 💊 · ${oName} −${stake} 💊`
          : result.winner === 'opponent'
            ? `${oName} +${stake} 💊 · ${cName} −${stake} 💊`
            : 'Hoà — không ai mất đan dược.',
      ].join('\n'),
    )
    .setFooter({ text: '⚔️ tấn công · 🛡️ thủ · ⚡ chí mạng · Phase 12' });

  await interaction.reply({ embeds: [embed], allowedMentions: { users: [opponent.id] } });
}

export const __for_testing = { duelMetadata, DUEL_COOLDOWN_MS, DUELS_PER_DAY_MAX };

export const command = { data, execute };
export default command;
