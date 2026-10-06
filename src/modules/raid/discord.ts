import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { env } from '../../config/env.js';
import { getStore } from '../../db/index.js';
import { getLook } from '../avatar/service.js';
import { webSecret } from '../avatar/web.js';
import { postTribulation } from '../bot-log.js';
import { withCard, withCardEdit } from '../cards/attach.js';
import { type RaidCardData, renderRaidCard } from '../cards/raid-card.js';
import type { Rendered } from '../pixel/output.js';
import { IDLE_CAP_MS } from './engine.js';
import {
  type ClaimReport,
  type RaidChangeError,
  changeRaid,
  claimRaid,
  getBoss,
  onBossKilled,
  raidView,
} from './service.js';
import { MONSTERS } from './zones.js';

/**
 * Discord side of the bí cảnh: the status card with Thu hoạch / Lên tầng /
 * Xuống tầng buttons and a signed link to the web page. The same service
 * runs both, so a member can play from either.
 */

export const RAID_CLAIM_ID = 'raid:claim';
export const RAID_UP_ID = 'raid:up';
export const RAID_DOWN_ID = 'raid:down';
export const RAID_LINK_TTL_MS = 6 * 60 * 60 * 1000;

const sign = (payload: string, secret: string): string =>
  createHmac('sha256', secret).update(`raid:${payload}`).digest('base64url');

export function raidToken(discordId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ d: discordId, e: now + RAID_LINK_TTL_MS })).toString(
    'base64url',
  );
  return `${payload}.${sign(payload, webSecret())}`;
}

export function readRaidToken(token: string, now = Date.now()): string | null {
  const [payload, mac] = token.split('.');
  const secret = webSecret();
  if (!payload || !mac || !secret) return null;
  const a = Buffer.from(sign(payload, secret));
  const b = Buffer.from(mac);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      d?: unknown;
      e?: unknown;
    };
    if (typeof body.d !== 'string' || typeof body.e !== 'number' || body.e < now) return null;
    return body.d;
  } catch {
    return null;
  }
}

export function raidUrl(discordId: string): string | null {
  if (!env.PUBLIC_BASE_URL || !webSecret()) return null;
  return `${env.PUBLIC_BASE_URL}/raid?t=${encodeURIComponent(raidToken(discordId))}`;
}

export function raidCardData(discordId: string, report?: ClaimReport): RaidCardData {
  const v = raidView(discordId);
  const store = getStore();
  const u = store.users.get(discordId);
  const boss = getBoss();
  return {
    name: u?.display_name ?? u?.username ?? 'Tu sĩ',
    look: getLook(discordId),
    companions: v.companions.map((c) => ({ name: c.name, look: getLook(c.id) })),
    zone: v.zone,
    floor: v.meta.floor,
    monsters: v.zone.monsters
      .map((m) => MONSTERS[m])
      .filter((m): m is NonNullable<typeof m> => Boolean(m)),
    power: v.power,
    monsterPower: v.monsterPower,
    killsPerHour: v.killsPerHour,
    elapsedMs: v.elapsedMs,
    idleCapMs: IDLE_CAP_MS,
    pendingKills: v.pendingKills,
    loot: v.pendingLoot,
    dayCapped: v.dayCapped,
    boss: { name: boss.name, hp: boss.hp, maxHp: boss.max_hp },
    claimed: report
      ? { kills: report.kills, ...report.loot, cleared: report.clearedFloor }
      : undefined,
  };
}

function buttons(discordId: string): ActionRowBuilder<ButtonBuilder>[] {
  const v = raidView(discordId);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(RAID_CLAIM_ID)
      .setLabel(`Thu hoạch (${v.pendingKills})`)
      .setStyle(ButtonStyle.Success)
      .setDisabled(v.pendingKills === 0),
    new ButtonBuilder()
      .setCustomId(RAID_DOWN_ID)
      .setLabel('Xuống tầng')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!v.canDown),
    new ButtonBuilder()
      .setCustomId(RAID_UP_ID)
      .setLabel(`Lên tầng ${v.meta.floor + 1}`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!v.canUp),
  );
  const url = raidUrl(discordId);
  if (url)
    row.addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Vào bí cảnh (web)').setURL(url),
    );
  return [row];
}

export function raidText(discordId: string, report?: ClaimReport): EmbedBuilder {
  const v = raidView(discordId);
  const lines = report
    ? [
        `Thu hoạch **${report.kills}** yêu thú ở ${report.zone.name} tầng ${report.floor}: +${report.loot.xp} XP, +${report.loot.pills} đan, +${report.loot.coins} cống hiến.`,
        report.dayCapped ? 'Đã chạm giới hạn thu nhập bí cảnh hôm nay (XP / đan / cống hiến).' : '',
        report.boss && report.boss.damage > 0
          ? `Gây ${report.boss.damage.toLocaleString('en-US')} sát thương lên boss tuần ${report.boss.name}.`
          : '',
      ]
    : [
        `**${v.zone.name}** tầng ${v.meta.floor} · đội ${v.power.toLocaleString('en-US')} lực chiến, quái ${v.monsterPower.toLocaleString('en-US')}.`,
        v.killsPerHour > 0
          ? `${v.killsPerHour} yêu thú mỗi giờ, treo tối đa 8 giờ. Đang chờ thu: ${v.pendingKills}.`
          : 'Đội không trụ nổi tầng này: xuống tầng hoặc thêm hộ pháp (`/bi-canh ho-phap`).',
      ];
  return new EmbedBuilder()
    .setColor(0x6fbf73)
    .setTitle('🗺️ Bí cảnh')
    .setDescription(lines.filter(Boolean).join('\n'))
    .setFooter({
      text: 'Đổi bãi: /bi-canh bai · Hộ pháp: /bi-canh ho-phap · Yêu thú lục: /bi-canh luc',
    });
}

export async function raidReply(discordId: string, report?: ClaimReport) {
  let card: Rendered | null = null;
  try {
    card = await renderRaidCard(raidCardData(discordId, report));
  } catch {
    card = null;
  }
  return { embed: raidText(discordId, report), card, components: buttons(discordId) };
}

export const CHANGE_ERROR: Record<RaidChangeError, string> = {
  'zone-locked': 'Bãi này chưa mở với cảnh giới của bạn.',
  'floor-locked':
    'Phải trụ vững tầng hiện tại (đội mạnh hơn quái) và thu hoạch trước khi lên tầng.',
  'bad-companion': 'Hộ pháp không hợp lệ (tối đa 2 người, không chọn chính mình).',
};

export async function handleRaidButton(interaction: ButtonInteraction): Promise<boolean> {
  const id = interaction.customId;
  if (id !== RAID_CLAIM_ID && id !== RAID_UP_ID && id !== RAID_DOWN_ID) return false;
  const who = interaction.user.id;
  if (!getStore().users.get(who)) {
    await interaction.reply({ content: '🌫️ Bạn chưa có hồ sơ tu sĩ.', ephemeral: true });
    return true;
  }
  await interaction.deferUpdate();
  let report: ClaimReport | undefined;
  let error: string | null = null;
  if (id === RAID_CLAIM_ID) report = await claimRaid(who);
  else {
    const floor = raidView(who).meta.floor + (id === RAID_UP_ID ? 1 : -1);
    const r = await changeRaid(who, { floor });
    if (r.ok) report = r.report.kills > 0 ? r.report : undefined;
    else error = CHANGE_ERROR[r.error];
  }
  const out = await raidReply(who, report);
  if (error) out.embed.setDescription(`⚠️ ${error}\n\n${out.embed.data.description ?? ''}`);
  await interaction.editReply({ ...withCardEdit(out.embed, out.card), components: out.components });
  return true;
}

export { withCard };

/** Public post when the weekly boss falls. */
export function wireRaidDiscord(): void {
  onBossKilled(async (boss, rewarded) => {
    const mentions = rewarded
      .slice(0, 40)
      .map((id) => `<@${id}>`)
      .join(' ');
    await postTribulation({
      content: [
        `🐉 **Boss tuần ${boss.name} đã bị hạ!**`,
        `${rewarded.length} đạo hữu góp sức đủ 1% máu nhận +300 XP, +5 đan, +100 cống hiến.`,
        mentions,
      ]
        .filter(Boolean)
        .join('\n'),
      allowedMentions: { parse: [] },
    });
  });
}
