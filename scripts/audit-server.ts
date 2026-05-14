#!/usr/bin/env tsx
/**
 * Phase 12.6 — server audit script.
 *
 * Read-only scan of the configured guild reporting:
 *   - Channel structure vs server-structure.ts expectations
 *   - Role structure vs ROLES expectations
 *   - Pinned message count per channel + which are bot-authored
 *   - Recent activity per channel (last message timestamp)
 *   - Member count + verified-vs-unverified breakdown
 *
 * Does NOT modify anything. Output is a human-readable text report on
 * stdout. Use case: pre-deploy sanity check, periodic state audit, or
 * input for the `/sync-pinned` decision.
 *
 * Usage:
 *   npm run audit-server
 *   # → prints report
 */

import 'dotenv/config';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { matchesChannelName } from '../src/config/channels.js';
import { env } from '../src/config/env.js';
import { BOT_PIN_MARKER, PINNED_MESSAGES } from '../src/config/pinned-messages.js';
import { CATEGORIES, ROLES } from '../src/config/server-structure.js';
import { logger } from '../src/utils/logger.js';

async function main(): Promise<void> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  await client.login(env.DISCORD_TOKEN);
  await new Promise<void>((resolve) => client.once('ready', () => resolve()));

  const guild = client.guilds.cache.get(env.DISCORD_GUILD_ID);
  if (!guild) {
    console.error(`[audit] guild ${env.DISCORD_GUILD_ID} not found in cache`);
    await client.destroy();
    process.exit(1);
  }

  await guild.members.fetch();

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📊 SERVER AUDIT — ${guild.name} (${guild.id})`);
  console.log(`Generated ${new Date().toISOString()}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  // === Members ===
  const total = guild.memberCount;
  const bots = guild.members.cache.filter((m) => m.user.bot).size;
  const humans = total - bots;
  console.log('👥 MEMBERS');
  console.log(`   Total: ${total} (${humans} humans + ${bots} bots)`);
  console.log('');

  // === Roles ===
  console.log('🎭 ROLES');
  const expectedRoles = new Set(ROLES.map((r) => r.name));
  const guildRoles = guild.roles.cache;
  const missingRoles: string[] = [];
  for (const r of ROLES) {
    if (!guildRoles.find((gr) => gr.name === r.name)) missingRoles.push(r.name);
  }
  console.log(
    `   Expected: ${ROLES.length} · Found in guild: ${guildRoles.filter((r) => expectedRoles.has(r.name)).size}`,
  );
  if (missingRoles.length > 0) {
    console.log(`   ⚠️ MISSING: ${missingRoles.join(', ')}`);
  } else {
    console.log('   ✅ All expected roles present');
  }
  console.log('');

  // === Channels ===
  console.log('📁 CHANNELS BY CATEGORY');
  for (const cat of CATEGORIES) {
    console.log(`   ${cat.name}:`);
    for (const def of cat.channels) {
      const ch = guild.channels.cache.find(
        (c) =>
          c.isTextBased() &&
          matchesChannelName(c, def.name.replace(/[^a-z0-9-]/gi, '').toLowerCase()),
      );
      const found = ch ? '✅' : '🌫️';
      console.log(`     ${found} ${def.name} [${def.type}, perm=${def.perm}]`);
    }
  }
  console.log('');

  // === Pinned messages audit ===
  console.log('📌 PINNED MESSAGES — CANONICAL CHANNELS');
  for (const def of PINNED_MESSAGES) {
    const ch = guild.channels.cache.find(
      (c) => c.isTextBased() && matchesChannelName(c, def.canonicalChannel),
    );
    if (!ch) {
      console.log(`   🌫️ #${def.canonicalChannel} — CHANNEL MISSING`);
      continue;
    }
    try {
      const pins = await (
        ch as { messages: { fetchPinned: () => Promise<Map<string, unknown>> } }
      ).messages.fetchPinned();
      const total = pins.size;
      let botPins = 0;
      let userPins = 0;
      for (const m of pins.values()) {
        const msg = m as {
          author: { id: string };
          embeds: ReadonlyArray<{ footer?: { text?: string } | null }>;
          content: string;
        };
        const isBot = msg.author.id === client.user?.id;
        const isMarked =
          msg.content.includes(BOT_PIN_MARKER) ||
          msg.embeds.some((e) => e.footer?.text?.includes(BOT_PIN_MARKER));
        if (isBot && isMarked) botPins++;
        else userPins++;
      }
      const hasBotPin = botPins > 0 ? '✅' : '⚠️';
      console.log(
        `   ${hasBotPin} #${def.canonicalChannel} — ${total} pins (${botPins} bot · ${userPins} user)`,
      );
    } catch (err) {
      console.log(`   ⚠️ #${def.canonicalChannel} — fetch failed: ${(err as Error).message}`);
    }
  }
  console.log('');

  // === Activity by channel (last message ts) ===
  console.log('💬 CHANNEL ACTIVITY (last message age)');
  const now = Date.now();
  const ageOf = (ts: number | null): string => {
    if (!ts) return 'never';
    const ms = now - ts;
    if (ms < 60_000) return '<1 min';
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} h`;
    return `${Math.floor(ms / 86_400_000)} d`;
  };
  const textChannels = guild.channels.cache.filter((c) => c.isTextBased());
  for (const ch of textChannels.values()) {
    try {
      const latest = await (
        ch as { messages: { fetch: (opts: { limit: number }) => Promise<Map<string, unknown>> } }
      ).messages.fetch({ limit: 1 });
      const last = latest.values().next().value as { createdTimestamp: number } | undefined;
      const ts = last?.createdTimestamp ?? null;
      console.log(`   #${(ch as { name: string }).name} — last: ${ageOf(ts)}`);
    } catch {
      console.log(`   #${(ch as { name: string }).name} — (fetch failed)`);
    }
  }
  console.log('');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Audit complete. No mutations applied.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await client.destroy();
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, 'audit-server crashed');
  console.error(err);
  process.exit(2);
});
