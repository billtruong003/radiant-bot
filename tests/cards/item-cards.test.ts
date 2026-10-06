import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCongPhapCatalog } from '../../src/config/cong-phap-catalog.js';
import { loadNhanCatalog } from '../../src/config/nhan-catalog.js';
import { loadPhapKhiCatalog } from '../../src/config/phap-khi-catalog.js';
import { loadWeaponCatalog } from '../../src/config/weapon-catalog.js';
import { Store, __setStoreForTesting } from '../../src/db/index.js';
import type { User } from '../../src/db/types.js';
import { forgeBanMenh, previewBanMenh } from '../../src/modules/arena/forge.js';
import { renderForgeCard, renderItemCard } from '../../src/modules/cards/dodac-cards.js';
import {
  bagItems,
  congPhapDetail,
  forgeView,
  nhanDetail,
  phapKhiDetail,
  renderBag,
  renderShop,
  resolveWeapon,
  weaponDetail,
} from '../../src/modules/cards/item-views.js';
import { ensureFont } from '../../src/modules/pixel/canvas.js';
import { mkTmpDir } from '../helpers/tmp-dir.js';

const ID = '123456789012345678';
let store: Store;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const tmp = await mkTmpDir();
  cleanup = tmp.cleanup;
  store = new Store({ dataDir: tmp.dir, snapshotIntervalMs: 2_000_000_000, fsync: false });
  await store.init();
  __setStoreForTesting(store);
  await ensureFont();
  for (const w of await loadWeaponCatalog()) await store.weaponCatalog.set(w);
  for (const c of await loadCongPhapCatalog()) await store.congPhapCatalog.set(c);
  for (const p of await loadPhapKhiCatalog()) await store.phapKhiCatalog.set(p);
  for (const n of await loadNhanCatalog()) await store.nhanCatalog.set(n);
  await store.users.set({
    discord_id: ID,
    username: 'tester',
    display_name: 'Tester',
    cultivation_rank: 'kim_dan',
    level: 24,
    xp: 48920,
    pills: 40,
    contribution_points: 1200,
  } as User);
});

afterAll(async () => {
  __setStoreForTesting(null);
  await store.shutdown();
  await cleanup();
});

describe('item cards from the real catalogs', () => {
  it('draws every catalog item without a missing icon', async () => {
    for (const w of store.weaponCatalog.query(() => true)) {
      const ref = resolveWeapon(ID, w.slug);
      expect(ref).not.toBeNull();
      if (ref) await renderItemCard(weaponDetail(ref, 3));
    }
    for (const c of store.congPhapCatalog.query(() => true))
      await renderItemCard(congPhapDetail(c, 0));
    for (const p of store.phapKhiCatalog.query(() => true))
      await renderItemCard(phapKhiDetail(p, 5));
    for (const n of store.nhanCatalog.query(() => true)) await renderItemCard(nhanDetail(n));
  }, 60_000);

  it('bag and shop show owned, equipped and locked items', async () => {
    const row = await forgeBanMenh(ID);
    const user = store.users.get(ID) as User;
    await store.users.set({ ...user, equipped_weapon_slug: row.weapon_slug });
    const bag = bagItems(ID, 'overview');
    expect(bag).toHaveLength(1);
    expect(bag[0]?.equipped).toBe(true);
    expect((await renderBag(ID, 'overview')).name).toMatch(/^tui-do\./);
    for (const kind of ['cong_phap', 'weapon', 'phap_khi', 'nhan'] as const) {
      const card = await renderShop(ID, kind);
      expect(card?.buffer.length).toBeGreaterThan(1000);
    }
    const forge = await renderForgeCard(forgeView(ID, previewBanMenh(ID).stats));
    expect(forge.name).toMatch(/^ban-menh\./);
  }, 60_000);
});
