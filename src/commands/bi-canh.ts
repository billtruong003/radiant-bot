import { type ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { getStore } from '../db/index.js';
import { withCard } from '../modules/cards/attach.js';
import { renderBestiaryCard } from '../modules/cards/bestiary-card.js';
import { CHANGE_ERROR, raidReply } from '../modules/raid/discord.js';
import { changeRaid, openZones } from '../modules/raid/service.js';
import { ZONES } from '../modules/raid/zones.js';

/**
 * /bi-canh — the idle hunting grounds. The party keeps fighting while you
 * are away (up to 8 hours); come back to collect. Also playable on the web
 * page linked from the card.
 */

export const data = new SlashCommandBuilder()
  .setName('bi-canh')
  .setDescription('Bí cảnh treo máy: săn yêu thú, thu hoạch, đánh boss tuần')
  .setDMPermission(false)
  .addSubcommand((sc) => sc.setName('xem').setDescription('Xem đội đang săn ở đâu và thu hoạch'))
  .addSubcommand((sc) =>
    sc
      .setName('bai')
      .setDescription('Đổi bãi săn (thu hoạch trước rồi chuyển)')
      .addStringOption((o) =>
        o
          .setName('bai')
          .setDescription('Bãi săn')
          .setRequired(true)
          .addChoices(...ZONES.map((z) => ({ name: z.name, value: z.id }))),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName('ho-phap')
      .setDescription('Mời tối đa 2 đồng môn làm hộ pháp (họ góp một nửa lực chiến)')
      .addUserOption((o) => o.setName('mot').setDescription('Hộ pháp thứ nhất').setRequired(false))
      .addUserOption((o) => o.setName('hai').setDescription('Hộ pháp thứ hai').setRequired(false)),
  )
  .addSubcommand((sc) =>
    sc.setName('luc').setDescription('Yêu thú lục: các bãi, quái và phần thưởng'),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const id = interaction.user.id;
  if (!getStore().users.get(id)) {
    await interaction.reply({
      content: '🌫️ Bạn chưa có hồ sơ tu sĩ — chat vài câu trước.',
      ephemeral: true,
    });
    return;
  }
  const sub = interaction.options.getSubcommand(true);
  await interaction.deferReply({ ephemeral: true });

  if (sub === 'luc') {
    const embed = new EmbedBuilder()
      .setColor(0x6fbf73)
      .setTitle('📜 Yêu thú lục')
      .setDescription(ZONES.map((z) => `**${z.name}** — ${z.lore}`).join('\n'));
    const card = await renderBestiaryCard(openZones(id).map((z) => z.id)).catch(() => null);
    await interaction.editReply(withCard(embed, card));
    return;
  }

  let error: string | null = null;
  let report;
  if (sub === 'bai') {
    const r = await changeRaid(id, { zone: interaction.options.getString('bai', true) });
    if (r.ok) report = r.report.kills > 0 ? r.report : undefined;
    else error = CHANGE_ERROR[r.error];
  }
  if (sub === 'ho-phap') {
    const picks = [interaction.options.getUser('mot'), interaction.options.getUser('hai')]
      .filter((u) => u !== null && !u.bot)
      .map((u) => u?.id ?? '');
    const r = await changeRaid(id, { companions: picks });
    if (r.ok) report = r.report.kills > 0 ? r.report : undefined;
    else error = CHANGE_ERROR[r.error];
  }
  const out = await raidReply(id, report);
  if (error) out.embed.setDescription(`⚠️ ${error}\n\n${out.embed.data.description ?? ''}`);
  await interaction.editReply({ ...withCard(out.embed, out.card), components: out.components });
}

export const command = { data, execute };
export default command;
