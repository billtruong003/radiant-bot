import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Store, __setStoreForTesting } from '../../src/db/index.js';
import type { User } from '../../src/db/types.js';
import { DEFAULT_LOOK, randomLook, validateLook } from '../../src/modules/avatar/catalog.js';
import {
  LINK_TTL_MS,
  SAVES_PER_MINUTE,
  createAvatarLink,
  readAvatarLink,
  resetAvatarLinks,
  takeSaveSlot,
} from '../../src/modules/avatar/link.js';
import { getLook } from '../../src/modules/avatar/service.js';
import { handleWeb } from '../../src/modules/web/router.js';
import { mkTmpDir } from '../helpers/tmp-dir.js';

// env is parsed when config/env.ts loads, so the secret must exist before imports run.
vi.hoisted(() => {
  process.env.WEB_LINK_SECRET = 'test-secret';
});
const SECRET = 'test-secret';

describe('avatar catalog', () => {
  it('refuses options the realm has not opened, accepts the rest', () => {
    expect(validateLook({ ...DEFAULT_LOOK, hair_style: 11 }, 'kim_dan')).toEqual({
      ok: false,
      error: 'Tai hồ ly chưa mở ở cảnh giới hiện tại.',
    });
    expect(validateLook({ ...DEFAULT_LOOK, hair_style: 11 }, 'nguyen_anh').ok).toBe(true);
    expect(validateLook({ ...DEFAULT_LOOK, skin: 99 }, 'tien_nhan').ok).toBe(false);
    expect(validateLook('nope', 'kim_dan').ok).toBe(false);
  });

  it('random looks only use opened options', () => {
    for (let i = 0; i < 50; i++)
      expect(validateLook(randomLook('pham_nhan'), 'pham_nhan').ok).toBe(true);
  });
});

describe('avatar links', () => {
  beforeEach(() => resetAvatarLinks());

  it('reads back, expires, and is replaced by a newer link', () => {
    const a = createAvatarLink('u1', SECRET, null, 1000);
    expect(readAvatarLink(a.token, SECRET, 2000)?.discordId).toBe('u1');
    expect(readAvatarLink(a.token, SECRET, 1000 + LINK_TTL_MS + 1)).toBeNull();
    const b = createAvatarLink('u1', SECRET, null, 3000);
    expect(readAvatarLink(a.token, SECRET, 3001)).toBeNull();
    expect(readAvatarLink(b.token, SECRET, 3001)?.discordId).toBe('u1');
  });

  it('rejects forged or foreign-secret links', () => {
    const a = createAvatarLink('u1', SECRET, null);
    const [payload] = a.token.split('.');
    expect(readAvatarLink(`${payload}.AAAA`, SECRET)).toBeNull();
    expect(readAvatarLink(a.token, 'other')).toBeNull();
  });

  it('limits saves per minute', () => {
    for (let i = 0; i < SAVES_PER_MINUTE; i++) expect(takeSaveSlot('u2', 10_000)).toBe(true);
    expect(takeSaveSlot('u2', 10_001)).toBe(false);
    expect(takeSaveSlot('u2', 80_000)).toBe(true);
  });
});

describe('avatar web api', () => {
  let server: Server;
  let base: string;
  let cleanup: () => Promise<void>;
  let store: Store;

  beforeAll(async () => {
    const tmp = await mkTmpDir('avatar');
    cleanup = tmp.cleanup;
    store = new Store({ dataDir: tmp.dir, snapshotIntervalMs: 2_000_000_000, fsync: false });
    await store.init();
    __setStoreForTesting(store);
    await store.users.set({
      discord_id: 'p1',
      username: 'p1',
      display_name: 'Tiểu Vũ',
      cultivation_rank: 'kim_dan',
    } as User);
    server = createServer((req, res) => {
      void handleWeb(req, res).then((ok) => {
        if (!ok) res.writeHead(404).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.close();
    __setStoreForTesting(null);
    await store.shutdown();
    await cleanup();
  });

  it('serves state, saves a valid look and refuses a locked one', async () => {
    resetAvatarLinks();
    const { token } = createAvatarLink('p1', SECRET, null);
    const state = (await (
      await fetch(`${base}/avatar/api/state?t=${encodeURIComponent(token)}`)
    ).json()) as {
      ok: boolean;
      name: string;
      hasLook: boolean;
      layers: { key: string; options: { locked: boolean }[] }[];
    };
    expect(state.ok).toBe(true);
    expect(state.name).toBe('Tiểu Vũ');
    expect(state.hasLook).toBe(false);
    expect(state.layers.find((l) => l.key === 'hair_style')?.options[11]?.locked).toBe(true);

    const save = (look: unknown) =>
      fetch(`${base}/avatar/api/save`, {
        method: 'POST',
        body: JSON.stringify({ t: token, look }),
      });
    const bad = await save({ ...DEFAULT_LOOK, hair_style: 11 });
    expect(bad.status).toBe(400);
    const good = await save({ ...DEFAULT_LOOK, robe_color: 2 });
    expect(good.status).toBe(200);
    expect(getLook('p1')?.robe_color).toBe(2);
  });

  it('shows the expired page for a dead link and serves sprites', async () => {
    const page = await fetch(`${base}/avatar?t=bogus`);
    expect(page.status).toBe(410);
    expect(await page.text()).toContain('Link này hết hạn rồi');
    const png = await fetch(`${base}/cult/sprites/hair.png`);
    expect(png.headers.get('content-type')).toBe('image/png');
    expect((await fetch(`${base}/cult/../../.env`)).status).toBe(404);
  });
});
