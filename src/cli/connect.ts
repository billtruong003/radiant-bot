import { Client, GatewayIntentBits, type Guild } from 'discord.js';
import { env } from '../config/env.js';

/**
 * Connects a fresh Discord client and resolves the configured target guild.
 * Caller must `await client.destroy()` when done.
 *
 * WARNING: the bot token is shared with `npm run dev`. If the bot is already
 * running, Discord will disconnect that session when this CLI logs in — by
 * design (one gateway connection per bot). Brief overlap is fine; the dev
 * bot reconnects when CLI exits.
 */
export async function connectBot(): Promise<{ client: Client; guild: Guild }> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
    ],
  });
  await client.login(env.DISCORD_TOKEN);
  const guild = await client.guilds.fetch(env.DISCORD_GUILD_ID);
  return { client, guild };
}
