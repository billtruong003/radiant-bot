/**
 * Finds one author's messages in a time range (from the chat archive) that
 * are still on Discord, and deletes them only when run with --confirm.
 * Made for cleaning up a scam raid after the fact.
 *
 *   npx tsx scripts/purge-spam.ts --author <id> --from 2026-09-29T13:50Z --to 2026-09-29T14:05Z [--min-attachments 1]
 *   ...same... --confirm
 */
import 'dotenv/config';
import { parseArgs } from 'node:util';
import Database from 'better-sqlite3';
import { Client, GatewayIntentBits } from 'discord.js';

const { values } = parseArgs({
  options: {
    author: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    'min-attachments': { type: 'string', default: '0' },
    confirm: { type: 'boolean', default: false },
  },
});
const from = Date.parse(values.from ?? '');
const to = Date.parse(values.to ?? '');
if (!values.author || Number.isNaN(from) || Number.isNaN(to)) {
  console.error(
    'Usage: --author <discord id> --from <ISO time> --to <ISO time> [--min-attachments N] [--confirm]',
  );
  process.exit(1);
}
const minAttachments = Number(values['min-attachments']);

const db = new Database(`${process.env.DATA_DIR ?? './data'}/messages.db`, { readonly: true });
const rows = db
  .prepare(
    'select id, channel_id from messages where author_id = ? and created_at between ? and ? order by created_at',
  )
  .all(values.author, from, to) as { id: string; channel_id: string }[];

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
await client.login(process.env.DISCORD_TOKEN);
const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID ?? '');

const found = (
  await Promise.all(
    rows.map(async (r) => {
      const channel = await guild.channels.fetch(r.channel_id).catch(() => null);
      if (!channel?.isTextBased()) return null;
      const message = await channel.messages.fetch(r.id).catch(() => null);
      return message && message.attachments.size >= minAttachments ? message : null;
    }),
  )
).filter((m) => m !== null);

console.log(
  `${rows.length} archived messages in range, ${found.length} still on Discord and matching.`,
);
for (const m of found)
  console.log(
    `  #${'name' in m.channel ? m.channel.name : m.channelId}  ${m.createdAt.toISOString()}  ${m.attachments.size} files  ${m.url}`,
  );

if (!values.confirm) {
  console.log('\nNothing deleted. Check the list, then run again with --confirm.');
} else {
  let deleted = 0;
  for (const m of found) {
    try {
      await m.delete();
      deleted++;
    } catch (err) {
      console.log(`  could not delete ${m.url}: ${(err as Error).message}`);
    }
  }
  console.log(`\nDeleted ${deleted} of ${found.length}.`);
}
await client.destroy();
