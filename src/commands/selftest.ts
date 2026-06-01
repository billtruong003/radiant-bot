import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  AttachmentBuilder,
  type ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { env } from '../config/env.js';
import { getStore } from '../db/index.js';
import { getSchedulerTaskCount } from '../modules/scheduler/index.js';
import { themedEmbed } from '../utils/embed.js';
import { logger } from '../utils/logger.js';

/**
 * /selftest — admin-only health diagnostic.
 *
 * Runs a battery of read-only in-process checks (store, scheduler, Discord
 * guild, health HTTP endpoint, GitHub backup freshness, Aki budget, automod
 * 24h activity), composes an embed + JSON log of failures, and DMs the
 * caller. Slash reply is ephemeral and only confirms the DM was sent.
 *
 * Each check is independent and isolated — a thrown exception in one
 * does not abort the others. The whole run targets <3s wall-clock.
 */

export const data = new SlashCommandBuilder()
  .setName('selftest')
  .setDescription('Diagnostic toàn bot — DM kết quả cho admin caller (admin only)')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

type CheckStatus = 'ok' | 'warn' | 'fail';

interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

const STATUS_ICON: Record<CheckStatus, string> = {
  ok: '✅',
  warn: '⚠️',
  fail: '❌',
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function fmtAge(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms < HOUR_MS) return `${(ms / 60_000).toFixed(0)}m`;
  if (ms < DAY_MS) return `${(ms / HOUR_MS).toFixed(1)}h`;
  return `${(ms / DAY_MS).toFixed(1)}d`;
}

async function safeRun(name: string, fn: () => Promise<CheckResult>): Promise<CheckResult> {
  try {
    return await fn();
  } catch (err) {
    return { name, status: 'fail', detail: `exception: ${(err as Error).message}` };
  }
}

async function checkStore(): Promise<CheckResult> {
  const store = getStore();
  const users = store.users.count();
  const xpLogs = store.xpLogs.count();
  const snapshotPath = store.getSnapshotPath();
  let snapDetail = 'no snapshot file';
  try {
    const stat = await fs.stat(snapshotPath);
    snapDetail = `snapshot ${fmtAge(Date.now() - stat.mtimeMs)} ago`;
  } catch {
    /* fresh start, no snapshot yet */
  }
  return {
    name: 'Store',
    status: 'ok',
    detail: `users=${users} · xp_logs=${xpLogs} · ${snapDetail}`,
  };
}

async function checkScheduler(): Promise<CheckResult> {
  const count = getSchedulerTaskCount();
  if (count === 0) return { name: 'Scheduler', status: 'fail', detail: 'no tasks running' };
  if (count < 6) {
    return { name: 'Scheduler', status: 'warn', detail: `${count} tasks (expected ≥6)` };
  }
  return { name: 'Scheduler', status: 'ok', detail: `${count} cron tasks running` };
}

async function checkDiscord(interaction: ChatInputCommandInteraction): Promise<CheckResult> {
  const guild = interaction.client.guilds.cache.get(env.DISCORD_GUILD_ID);
  if (!guild) {
    return {
      name: 'Discord guild',
      status: 'fail',
      detail: `guild ${env.DISCORD_GUILD_ID} not in cache`,
    };
  }
  const members = guild.memberCount;
  const channels = guild.channels.cache.size;
  const ping = interaction.client.ws.ping;
  const pingDetail = ping < 0 ? 'ping=initializing' : `ping=${ping}ms`;
  return {
    name: 'Discord guild',
    status: 'ok',
    detail: `${guild.name} · members=${members} · channels=${channels} · ${pingDetail}`,
  };
}

async function checkHealthEndpoint(): Promise<CheckResult> {
  if (env.HEALTH_PORT === 0) {
    return { name: 'Health endpoint', status: 'warn', detail: 'HEALTH_PORT=0 (disabled)' };
  }
  const res = await fetch(`http://localhost:${env.HEALTH_PORT}/health`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) {
    return { name: 'Health endpoint', status: 'fail', detail: `HTTP ${res.status}` };
  }
  const body = (await res.json()) as { status?: string; uptime_ms?: number };
  return {
    name: 'Health endpoint',
    status: body.status === 'ok' ? 'ok' : 'warn',
    detail: `status=${body.status} · uptime=${fmtAge(body.uptime_ms ?? 0)}`,
  };
}

async function checkBackup(): Promise<CheckResult> {
  const backupSnapshot = path.join(process.cwd(), 'backup-repo', 'snapshot.json');
  const stat = await fs.stat(backupSnapshot);
  const ageMs = Date.now() - stat.mtimeMs;
  const detail = `last push ${fmtAge(ageMs)} ago`;
  // Backup runs daily at 00:00 VN. >36h means at least one nightly cycle was
  // skipped — almost certainly a token / auth failure.
  if (ageMs > 36 * HOUR_MS) {
    return { name: 'Backup', status: 'fail', detail: `${detail} (>36h — likely broken)` };
  }
  if (ageMs > 26 * HOUR_MS) {
    return { name: 'Backup', status: 'warn', detail: `${detail} (>26h)` };
  }
  return { name: 'Backup', status: 'ok', detail };
}

async function checkAkiBudget(): Promise<CheckResult> {
  const budget = env.AKI_DAILY_BUDGET_USD;
  if (budget === 0) {
    return { name: 'Aki budget', status: 'warn', detail: 'budget=$0 (disabled)' };
  }
  const store = getStore();
  const dayAgo = Date.now() - DAY_MS;
  const recent = store.akiLogs.query((l) => l.created_at >= dayAgo);
  const cost = recent.reduce((s, l) => s + l.cost_usd + (l.filter_cost_usd ?? 0), 0);
  const pct = (cost / budget) * 100;
  const detail = `$${cost.toFixed(4)} / $${budget.toFixed(2)} (${pct.toFixed(0)}%) · ${recent.length} calls/24h`;
  if (pct >= 100) return { name: 'Aki budget', status: 'fail', detail: `${detail} — EXCEEDED` };
  if (pct >= 80) return { name: 'Aki budget', status: 'warn', detail };
  return { name: 'Aki budget', status: 'ok', detail };
}

async function checkAutomod(): Promise<CheckResult> {
  const store = getStore();
  const dayAgo = Date.now() - DAY_MS;
  const recent = store.automodLogs.query((l) => l.created_at >= dayAgo);
  return {
    name: 'Automod',
    status: 'ok',
    detail: `${recent.length} hits in last 24h`,
  };
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  logger.info({ invoked_by: interaction.user.id, tag: interaction.user.tag }, 'command: /selftest');

  await interaction.deferReply({ ephemeral: true });

  const startedAt = Date.now();
  const checks: CheckResult[] = await Promise.all([
    safeRun('Store', checkStore),
    safeRun('Scheduler', checkScheduler),
    safeRun('Discord guild', () => checkDiscord(interaction)),
    safeRun('Health endpoint', checkHealthEndpoint),
    safeRun('Backup', checkBackup),
    safeRun('Aki budget', checkAkiBudget),
    safeRun('Automod', checkAutomod),
  ]);
  const elapsed = Date.now() - startedAt;

  const failCount = checks.filter((c) => c.status === 'fail').length;
  const warnCount = checks.filter((c) => c.status === 'warn').length;
  const okCount = checks.filter((c) => c.status === 'ok').length;

  const theme: 'success' | 'warn' | 'danger' =
    failCount > 0 ? 'danger' : warnCount > 0 ? 'warn' : 'success';
  const headline =
    failCount > 0
      ? `❌ ${failCount} FAIL · ${warnCount} WARN · ${okCount} OK`
      : warnCount > 0
        ? `⚠️ ${warnCount} WARN · ${okCount} OK`
        : `✅ Tất cả ${okCount} check pass`;

  const lines = checks.map((c) => `${STATUS_ICON[c.status]} **${c.name}** — ${c.detail}`);

  const embed = themedEmbed(theme, {
    title: '🩺 /selftest — Bot diagnostic',
    description: [headline, '', ...lines, '', `_Hoàn tất trong ${elapsed}ms_`].join('\n'),
    footer: `selftest · run by ${interaction.user.tag}`,
  });

  const attachments: AttachmentBuilder[] = [];
  if (failCount > 0 || warnCount > 0) {
    const raw = JSON.stringify(
      {
        ran_at: new Date().toISOString(),
        elapsed_ms: elapsed,
        summary: { ok: okCount, warn: warnCount, fail: failCount },
        checks,
      },
      null,
      2,
    );
    attachments.push(
      new AttachmentBuilder(Buffer.from(raw, 'utf-8'), { name: 'selftest-log.json' }),
    );
  }

  try {
    const dm = await interaction.user.createDM();
    await dm.send({ embeds: [embed], files: attachments });
    await interaction.editReply({ content: '✅ Đã gửi kết quả qua DM.' });
  } catch (err) {
    logger.warn(
      { err, user_id: interaction.user.id },
      'selftest: DM failed, falling back to ephemeral',
    );
    await interaction.editReply({
      content: '⚠️ DM bị block — kết quả hiện ngay tại đây.',
      embeds: [embed],
      files: attachments,
    });
  }
}

export const command = { data, execute };
export default command;
