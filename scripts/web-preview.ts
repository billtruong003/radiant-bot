/**
 * Runs the player web pages locally with a throwaway store and sample
 * players, and prints links to open. For checking the pages by eye.
 *
 *   WEB_LINK_SECRET=dev JUDGE_LOCAL=1 npx tsx scripts/web-preview.ts [port]
 */

import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Store, __setStoreForTesting } from '../src/db/index.js';
import type { User } from '../src/db/types.js';
import { createAvatarLink } from '../src/modules/avatar/link.js';
import { webSecret } from '../src/modules/avatar/web.js';
import { createTrial, pickProblems, trialToken } from '../src/modules/judge/trial.js';
import { handleWeb } from '../src/modules/web/router.js';

const port = Number(process.argv[2] ?? 4567);
const dir = await mkdtemp(path.join(os.tmpdir(), 'radiant-web-'));
const store = new Store({ dataDir: dir, snapshotIntervalMs: 2_000_000_000, fsync: false });
await store.init();
__setStoreForTesting(store);
await store.users.set({
  discord_id: 'dev1',
  username: 'billthedev',
  display_name: 'Bill The Dev',
  cultivation_rank: 'kim_dan',
  level: 24,
  xp: 48920,
} as User);

createServer((req, res) => {
  void handleWeb(req, res).then((ok) => {
    if (!ok) res.writeHead(404).end('not found');
  });
}).listen(port, () => {
  const { token } = createAvatarLink('dev1', webSecret(), null);
  process.stdout.write(`avatar: http://127.0.0.1:${port}/avatar?t=${encodeURIComponent(token)}\n`);
});

const trial = await createTrial({
  discordId: 'dev1',
  mode: 'tribulation',
  tier: 'cuu_thien',
  problems: pickProblems('cuu_thien'),
  durationMs: 90 * 60_000,
});
process.stdout.write(
  `judge: http://127.0.0.1:${port}/judge?t=${encodeURIComponent(trialToken(trial, webSecret()))}\n`,
);
