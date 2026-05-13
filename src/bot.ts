import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { env } from './config/env.js';
import { register as registerGuildMemberAdd } from './events/guildMemberAdd.js';
import { register as registerInteractionCreate } from './events/interactionCreate.js';
import { register as registerMessageCreate } from './events/messageCreate.js';
import { register as registerMessageReactionAdd } from './events/messageReactionAdd.js';
import { register as registerMessageReactionRemove } from './events/messageReactionRemove.js';
import { clearBotLogClient, setBotLogClient } from './modules/bot-log.js';
import { startCooldownSweeps, stopCooldownSweeps } from './modules/leveling/cooldown.js';
import { startScheduler, stopScheduler } from './modules/scheduler/index.js';
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
  });

  // Wire feature handlers BEFORE login so no event can fire un-handled
  // during the brief READY → handler-register window.
  registerGuildMemberAdd(client);
  registerMessageCreate(client);
  registerMessageReactionAdd(client);
  registerMessageReactionRemove(client);
  registerInteractionCreate(client);

  client.once(Events.ClientReady, (c) => {
    logger.info({ tag: c.user.tag, id: c.user.id, guilds: c.guilds.cache.size }, 'logged in');
    setBotLogClient(c);
    startScheduler(c);
    startCooldownSweeps();
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
  clearBotLogClient();
  await client.destroy();
}
