import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  ComponentType,
  EmbedBuilder,
  type Message,
  type MessageActionRowComponentBuilder,
  SlashCommandBuilder,
} from 'discord.js';
import { env } from '../config/env.js';
import { getStore } from '../db/index.js';
import type { Hunter, HunterProfile } from '../db/types.js';
import { RANK_COLOR, drawHunterCard, topShare } from '../modules/hunter/card.js';
import { simulateHunterDuel } from '../modules/hunter/duel.js';
import { REFRESH_COOLDOWN_MS, freshHunter } from '../modules/hunter/link.js';
import { authorizeUrl, createState } from '../modules/hunter/oauth.js';
import { combatFrom } from '../modules/hunter/power.js';
import { logger } from '../utils/logger.js';

/**
 * `/hunter` — sức mạnh Thợ Săn: một hệ sức mạnh riêng lấy từ tài khoản GitHub
 * (qua Git Profile Awaken). Không đụng tới cảnh giới, XP hay vật phẩm cũ.
 */

const ACCEPT_WINDOW_MS = 60_000;
const DUEL_COOLDOWN_MS = 30_000;
const DUELS_PER_DAY = 20;
const lastDuel = new Map<string, number>();
const duelsToday = new Map<string, { day: string; count: number }>();

export const data = new SlashCommandBuilder()
  .setName('hunter')
  .setDescription('Sức mạnh Thợ Săn từ GitHub của bạn')
  .setDMPermission(false)
  .addSubcommand((s) =>
    s.setName('register').setDescription('Liên kết GitHub để thức tỉnh sức mạnh Thợ Săn'),
  )
  .addSubcommand((s) =>
    s
      .setName('card')
      .setDescription('Xem thẻ Thợ Săn')
      .addUserOption((o) => o.setName('user').setDescription('Thợ săn cần xem (mặc định là bạn)')),
  )
  .addSubcommand((s) =>
    s.setName('refresh').setDescription('Cập nhật chỉ số từ GitHub (1 lần mỗi giờ)'),
  )
  .addSubcommand((s) =>
    s
      .setName('duel')
      .setDescription('Đấu tay đôi bằng sức mạnh Thợ Săn')
      .addUserOption((o) =>
        o
          .setName('user')
          .setDescription('Đối thủ (cũng phải đã liên kết GitHub)')
          .setRequired(true),
      ),
  )
  .addSubcommand((s) => s.setName('top').setDescription('Bảng xếp hạng sức mạnh Thợ Săn'))
  .addSubcommand((s) => s.setName('unlink').setDescription('Huỷ liên kết GitHub'));

type Linked = Hunter & { profile: HunterProfile };
const isLinked = (h: Hunter | null): h is Linked => !!h?.profile;

async function register(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!env.PUBLIC_BASE_URL || !env.GITHUB_OAUTH_CLIENT_ID || !env.HUNTER_STATE_SECRET) {
    await interaction.reply({
      content:
        '⚙️ Tính năng Thợ Săn chưa được cấu hình trên server này. Báo admin bật GitHub OAuth.',
      ephemeral: true,
    });
    return;
  }
  const state = createState(interaction.user.id, env.HUNTER_STATE_SECRET);
  const url = authorizeUrl(
    env.GITHUB_OAUTH_CLIENT_ID,
    `${env.PUBLIC_BASE_URL}/oauth/github/callback`,
    state,
  );
  const button = new ButtonBuilder()
    .setLabel('Đăng nhập GitHub')
    .setStyle(ButtonStyle.Link)
    .setURL(url);
  await interaction.reply({
    content: [
      '🗝️ **Thức tỉnh Thợ Săn**',
      'Đăng nhập GitHub để chứng minh tài khoản là của bạn. Bot chỉ đọc hồ sơ công khai, không xin quyền vào repo.',
      'Link dùng một lần, hết hạn sau 10 phút. Xong thì gõ `/hunter card`.',
    ].join('\n'),
    components: [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(button)],
    ephemeral: true,
  });
}

async function card(interaction: ChatInputCommandInteraction): Promise<void> {
  const target = interaction.options.getUser('user') ?? interaction.user;
  await interaction.deferReply();
  const hunter = await freshHunter(target.id);
  if (!isLinked(hunter)) {
    await interaction.editReply(
      target.id === interaction.user.id
        ? '🌫️ Bạn chưa thức tỉnh. Gõ `/hunter register` để liên kết GitHub.'
        : `🌫️ ${target.username} chưa thức tỉnh sức mạnh Thợ Săn.`,
    );
    return;
  }
  const member = await interaction.guild?.members.fetch(target.id).catch(() => null);
  const png = drawHunterCard({ displayName: member?.displayName ?? target.username, hunter });
  await interaction.editReply({ files: [new AttachmentBuilder(png, { name: 'hunter.png' })] });
}

async function refresh(interaction: ChatInputCommandInteraction): Promise<void> {
  const current = getStore().hunters.get(interaction.user.id);
  if (!current) {
    await interaction.reply({
      content: '🌫️ Bạn chưa thức tỉnh. Gõ `/hunter register` trước.',
      ephemeral: true,
    });
    return;
  }
  const wait = current.fetched_at + REFRESH_COOLDOWN_MS - Date.now();
  if (wait > 0) {
    await interaction.reply({
      content: `⏳ Chỉ số vừa cập nhật. Thử lại sau ${Math.ceil(wait / 60_000)} phút.`,
      ephemeral: true,
    });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const hunter = await freshHunter(interaction.user.id, true);
  await interaction.editReply(
    isLinked(hunter) && hunter.fetched_at > current.fetched_at
      ? `✅ Đã cập nhật. Sức mạnh Thợ Săn: **${combatFrom(hunter.profile).power.toLocaleString('vi-VN')}**.`
      : '⚠️ Không lấy được chỉ số mới lúc này, vẫn giữ chỉ số cũ. Thử lại sau.',
  );
}

const dayKey = (now: number): string => new Date(now + 7 * 3600_000).toISOString().slice(0, 10);

async function duel(interaction: ChatInputCommandInteraction): Promise<void> {
  const challenger = interaction.user;
  const opponent = interaction.options.getUser('user', true);
  const now = Date.now();
  if (opponent.id === challenger.id || opponent.bot) {
    await interaction.reply({ content: '🤨 Chọn một thợ săn khác.', ephemeral: true });
    return;
  }
  const since = now - (lastDuel.get(challenger.id) ?? 0);
  if (since < DUEL_COOLDOWN_MS) {
    await interaction.reply({
      content: `⏳ Hồi sức thêm ${Math.ceil((DUEL_COOLDOWN_MS - since) / 1000)} giây.`,
      ephemeral: true,
    });
    return;
  }
  const today = duelsToday.get(challenger.id);
  if (today?.day === dayKey(now) && today.count >= DUELS_PER_DAY) {
    await interaction.reply({
      content: `🛑 Hôm nay bạn đã đấu ${DUELS_PER_DAY} trận. Mai quay lại.`,
      ephemeral: true,
    });
    return;
  }
  const [a, b] = await Promise.all([freshHunter(challenger.id), freshHunter(opponent.id)]);
  if (!isLinked(a) || !isLinked(b)) {
    await interaction.reply({
      content: `🌫️ ${!isLinked(a) ? 'Bạn' : opponent.username} chưa thức tỉnh. Cả hai phải \`/hunter register\` trước.`,
      ephemeral: true,
    });
    return;
  }
  lastDuel.set(challenger.id, now);

  const ca = combatFrom(a.profile);
  const cb = combatFrom(b.profile);
  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('hunter-duel:accept')
      .setLabel('Nhận đấu')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('hunter-duel:decline')
      .setLabel('Từ chối')
      .setStyle(ButtonStyle.Secondary),
  );
  const challenge = new EmbedBuilder()
    .setColor(0x3d8bff)
    .setTitle('⚔️ Thách đấu Thợ Săn')
    .setDescription(
      [
        `**${challenger.username}** · rank ${a.profile.overall.rank} · sức mạnh ${ca.power}`,
        'đấu với',
        `**${opponent.username}** · rank ${b.profile.overall.rank} · sức mạnh ${cb.power}`,
        '',
        `${opponent} có 60 giây để nhận. Không cược gì, chỉ tính thắng thua.`,
      ].join('\n'),
    );
  const message = (await interaction.reply({
    content: `${opponent}`,
    embeds: [challenge],
    components: [row],
    allowedMentions: { users: [opponent.id] },
    fetchReply: true,
  })) as Message;

  try {
    const click = await message.awaitMessageComponent({
      filter: (i) => i.user.id === opponent.id,
      componentType: ComponentType.Button,
      time: ACCEPT_WINDOW_MS,
    });
    if (click.customId === 'hunter-duel:decline') {
      await click.update({
        content: `${opponent.username} đã từ chối.`,
        embeds: [],
        components: [],
        allowedMentions: { parse: [] },
      });
      return;
    }
    const result = simulateHunterDuel(
      { name: challenger.username, combat: ca },
      { name: opponent.username, combat: cb },
      now ^ Number(BigInt(challenger.id) % 1_000_000n),
    );
    const [winner, loser] = result.winner === 0 ? [challenger, opponent] : [opponent, challenger];
    const store = getStore();
    await store.hunters.incr(winner.id, 'duel_wins', 1);
    await store.hunters.incr(loser.id, 'duel_losses', 1);
    duelsToday.set(challenger.id, {
      day: dayKey(now),
      count: today?.day === dayKey(now) ? today.count + 1 : 1,
    });

    const names = [challenger.username, opponent.username];
    const highlights = result.hits.filter((h) => h.crit || h.evaded || h.hpLeft === 0).slice(-5);
    const lines = highlights.map((h) =>
      h.evaded
        ? `R${h.round} · ${names[1 - h.attacker]} né đòn của ${names[h.attacker]}`
        : `R${h.round} · ${names[h.attacker]} ${h.crit ? '**chí mạng** ' : ''}gây ${h.damage} sát thương${h.hpLeft === 0 ? ' — **hạ gục**' : ''}`,
    );
    const resultEmbed = new EmbedBuilder()
      .setColor(
        Number.parseInt(
          (RANK_COLOR[(result.winner === 0 ? a : b).profile.overall.rank] ?? '#3d8bff').slice(1),
          16,
        ),
      )
      .setTitle(`🏆 ${winner.username} thắng`)
      .setDescription(
        [
          ...(lines.length ? lines : ['Hai bên giằng co tới hiệp cuối.']),
          '',
          `HP còn lại: ${names[0]} ${result.hpLeft[0]}/${ca.hp} · ${names[1]} ${result.hpLeft[1]}/${cb.hp}`,
          `${result.rounds} hiệp · ${result.hits.length} đòn`,
        ].join('\n'),
      );
    await click.update({
      content: '',
      embeds: [resultEmbed],
      components: [],
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    if ((err as { code?: string }).code !== 'InteractionCollectorError')
      logger.warn({ err: (err as Error).message }, 'hunter duel failed');
    await interaction
      .editReply({
        content: `⌛ ${opponent.username} không trả lời.`,
        embeds: [],
        components: [],
        allowedMentions: { parse: [] },
      })
      .catch(() => undefined);
  }
}

async function top(interaction: ChatInputCommandInteraction): Promise<void> {
  const ranked = getStore()
    .hunters.all()
    .filter(isLinked)
    .map((h) => ({ h, power: combatFrom(h.profile).power }))
    .sort((x, y) => y.power - x.power)
    .slice(0, 10);
  if (!ranked.length) {
    await interaction.reply({
      content: 'Chưa có ai thức tỉnh. Mở đầu bằng `/hunter register`.',
      ephemeral: true,
    });
    return;
  }
  const lines = ranked.map(
    ({ h, power }, i) =>
      `**${i + 1}.** <@${h.discord_id}> · ${h.profile.overall.rank} · ${topShare(h.profile.overall.percentile)} · **${power}** · ${h.duel_wins}W/${h.duel_losses}L`,
  );
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x3d8bff)
        .setTitle('🗡️ Bảng xếp hạng Thợ Săn')
        .setDescription(lines.join('\n')),
    ],
    allowedMentions: { parse: [] },
  });
}

async function unlink(interaction: ChatInputCommandInteraction): Promise<void> {
  const removed = await getStore().hunters.delete(interaction.user.id);
  await interaction.reply({
    content: removed
      ? '✅ Đã huỷ liên kết GitHub. Cảnh giới và vật phẩm của bạn không bị ảnh hưởng.'
      : 'Bạn chưa liên kết GitHub.',
    ephemeral: true,
  });
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const handlers: Record<string, (i: ChatInputCommandInteraction) => Promise<void>> = {
    register,
    card,
    refresh,
    duel,
    top,
    unlink,
  };
  await handlers[interaction.options.getSubcommand()]?.(interaction);
}

export const command = { data, execute };
