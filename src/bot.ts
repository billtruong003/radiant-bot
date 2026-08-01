import { Client, Events, GatewayIntentBits, Options, Partials } from 'discord.js';
import { env } from './config/env.js';
import { register as registerGuildMemberAdd } from './events/guildMemberAdd.js';
import { register as registerGuildMemberUpdate } from './events/guildMemberUpdate.js';
import { register as registerInteractionCreate } from './events/interactionCreate.js';
import { register as registerMessageCreate } from './events/messageCreate.js';
import { register as registerMessageReactionAdd } from './events/messageReactionAdd.js';
import { register as registerMessageReactionRemove } from './events/messageReactionRemove.js';
import { startAkiCooldownSweeps, stopAkiCooldownSweeps } from './modules/aki/rate-limit.js';
import { clearBotLogClient, setBotLogClient } from './modules/bot-log.js';
import { startCooldownSweeps, stopCooldownSweeps } from './modules/leveling/cooldown.js';
import { startScheduler, stopScheduler } from './modules/scheduler/index.js';
import { startHealthServer, stopHealthServer } from './utils/health.js';
import { logger } from './utils/logger.js';

export async function startBot(): Promise<Client> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction],

    // Cache bounds + sweepers. discord.js defaults cap MessageManager at
    // 200/channel but NEVER sweep it, and leave GuildMemberManager /
    // UserManager unbounded — with MessageContent + Partials.Message that
    // means full message bodies pile up per channel for the process
    // lifetime. `automod/actions.ts` fetches up to 100 messages per
    // retroactive profanity sweep straight into that cache.
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 50,
      // Nothing in this bot reads presence or invites.
      PresenceManager: 0,
      GuildInviteManager: 0,
    }),
    sweepers: {
      ...Options.DefaultSweeperSettings,
      // Automod only ever looks at very recent messages; anything older is
      // dead weight.
      messages: { interval: 600, lifetime: 1800 },
      // Drop cached bot users (never needed again). Our own user is
      // excluded — evicting it breaks client.user.
      users: {
        interval: 3600,
        filter: () => (user) => user.bot && user.id !== user.client.user?.id,
      },
    },
  });

  // Wire feature handlers BEFORE login so no event can fire un-handled
  // during the brief READY → handler-register window.
  registerGuildMemberAdd(client);
  registerGuildMemberUpdate(client);
  registerMessageCreate(client);
  registerMessageReactionAdd(client);
  registerMessageReactionRemove(client);
  registerInteractionCreate(client);

  client.once(Events.ClientReady, (c) => {
    logger.info({ tag: c.user.tag, id: c.user.id, guilds: c.guilds.cache.size }, 'logged in');
    setBotLogClient(c);
    startScheduler(c);
    startCooldownSweeps();
    startAkiCooldownSweeps();
    startHealthServer(env.HEALTH_PORT, c);
  });

  client.on(Events.Error, (err) => {
    logger.error({ err }, 'discord client error');
  });

  client.on(Events.Warn, (msg) => {
    logger.warn({ msg }, 'discord client warning');
  });

  await client.login(env.DISCORD_TOKEN);
  return client;
}

export async function stopBot(client: Client): Promise<void> {
  stopScheduler();
  stopCooldownSweeps();
  stopAkiCooldownSweeps();
  stopHealthServer();
  clearBotLogClient();
  await client.destroy();
}
