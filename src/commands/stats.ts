import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { getStore } from '../db/index.js';

/**
 * `/stats` — admin-only ephemeral dashboard for Phase 11.2 visibility.
 *
 * Bill shipped a lot of new behaviour in Phase 11.2 (graduated profanity,
 * narration, history sweep, permissive link policy) with no surfaced
 * counters. This command rolls everything into one read-only embed.
 *
 * Read-only: no writes, no side-effects on the store. Computes
 * everything from in-memory collections + filters.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Bảng tổng quan hoạt động bot (admin only)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

function fmtNumber(n: number): string {
  return n.toLocaleString('vi-VN');
}

function fmtCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(5)}`;
  return `$${usd.toFixed(3)}`;
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const store = getStore();
  const now = Date.now();
  const dayAgo = now - DAY_MS;
  const weekAgo = now - WEEK_MS;

  // --- Member stats ---
  const allUsers = store.users.query(() => true);
  const totalMembers = allUsers.length;
  const verifiedMembers = allUsers.filter((u) => u.verified_at !== null).length;
  const active7d = allUsers.filter(
    (u) => u.last_message_at !== null && u.last_message_at >= weekAgo,
  ).length;

  // --- Top 5 XP ---
  const topXp = [...allUsers]
    .sort((a, b) => b.xp - a.xp)
    .slice(0, 5)
    .map(
      (u, i) =>
        `${i + 1}. ${u.display_name ?? u.username} — **${fmtNumber(u.xp)} XP** (Lv ${u.level})`,
    );

  // --- Automod stats (last 24h, by rule) ---
  const recentAutomod = store.automodLogs.query((log) => log.created_at >= dayAgo);
  const automodByRule = new Map<string, number>();
  for (const log of recentAutomod) {
    automodByRule.set(log.rule, (automodByRule.get(log.rule) ?? 0) + 1);
  }
  const automodLines =
    automodByRule.size === 0
      ? ['_Không có hit nào trong 24h._']
      : [...automodByRule.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([rule, count]) => `• \`${rule}\`: **${count}**`);

  // --- Aki stats (last 24h) ---
  const recentAki = store.akiLogs.query((log) => log.created_at >= dayAgo);
  const akiCalls = recentAki.length;
  const akiRefusals = recentAki.filter((l) => l.refusal).length;
  const akiCostToday = recentAki.reduce((sum, l) => sum + l.cost_usd + (l.filter_cost_usd ?? 0), 0);
  // Group by filter_stage for routing visibility
  const filterStages = new Map<string, number>();
  for (const log of recentAki) {
    const stage = log.filter_stage ?? 'unknown';
    filterStages.set(stage, (filterStages.get(stage) ?? 0) + 1);
  }
  const akiLines = [
    `• Calls (24h): **${akiCalls}** (refusal: ${akiRefusals})`,
    `• Cost (24h): **${fmtCost(akiCostToday)}**`,
    filterStages.size > 0
      ? `• Filter stages: ${[...filterStages.entries()].map(([s, c]) => `\`${s}\`=${c}`).join(', ')}`
      : '',
  ].filter(Boolean);

  // --- Build embed ---
  const embed = new EmbedBuilder()
    .setColor(0x2c3e50)
    .setTitle('📊 Bot Stats — 24h overview')
    .addFields(
      {
        name: '👥 Member',
        value: [
          `• Total: **${fmtNumber(totalMembers)}**`,
          `• Verified: **${fmtNumber(verifiedMembers)}** (${totalMembers ? ((verifiedMembers / totalMembers) * 100).toFixed(0) : 0}%)`,
          `• Active 7d: **${fmtNumber(active7d)}**`,
        ].join('\n'),
        inline: false,
      },
      {
        name: '🏆 Top 5 XP',
        value: topXp.length ? topXp.join('\n') : '_Chưa có ai earn XP._',
        inline: false,
      },
      {
        name: '🛡️ Automod hits (24h)',
        value: automodLines.join('\n'),
        inline: true,
      },
      {
        name: '🤖 Aki',
        value: akiLines.join('\n') || '_Không có call nào trong 24h._',
        inline: true,
      },
    )
    .setFooter({ text: `Snapshot at ${new Date(now).toLocaleString('vi-VN')}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

export const command = { data, execute };
export default command;
