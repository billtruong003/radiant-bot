import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { env } from './config/env.js';
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

  client.once(Events.ClientReady, (c) => {
    logger.info({ tag: c.user.tag, id: c.user.id, guilds: c.guilds.cache.size }, 'logged in');
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
  await client.destroy();
}
