/**
 * Renders every cultivation card with sample data into tmp/preview so they
 * can be checked by eye against the mockups.
 *
 *   npx tsx scripts/render-preview.ts [name-filter]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Cards never talk to Discord; placeholders keep the env schema happy.
for (const k of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID'])
  process.env[k] ??= 'preview';
const { PREVIEWS } = await import('../src/modules/cards/previews.js');

const out = path.join(process.cwd(), 'tmp', 'preview');
await mkdir(out, { recursive: true });
const filter = process.argv[2];
for (const [name, make] of Object.entries(PREVIEWS)) {
  if (filter && !name.includes(filter)) continue;
  const started = Date.now();
  const r = await make();
  await writeFile(path.join(out, r.name), r.buffer);
  process.stdout.write(`${r.name.padEnd(34)} ${(r.buffer.byteLength / 1024).toFixed(0).padStart(6)} KB  ${Date.now() - started} ms
`);
}
