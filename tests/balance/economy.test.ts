import { describe, expect, it } from 'vitest';
import { TRIBULATION_TIERS } from '../../src/config/leveling.js';
import { dailyIncome, incomeRows, weaponToSeven } from '../../src/modules/balance/economy.js';

/**
 * Guard rails for the economy (docs/ECONOMY.md). If a change trips one of
 * these, update the doc with the reason before loosening the bound.
 */
describe('economy guard rails', () => {
  const { before, after } = dailyIncome();

  it('new content at most triples daily pills and quintuples cống hiến', () => {
    expect(after.pills / before.pills).toBeLessThanOrEqual(3);
    expect(after.coins / before.coins).toBeLessThanOrEqual(5);
  });

  it('a +7 weapon still takes more than two weeks of full play', () => {
    const w = weaponToSeven();
    expect(w.pills / after.pills).toBeGreaterThan(14);
    expect(w.coins / after.coins).toBeGreaterThan(14);
  });

  it('every source pays something and the table lists six sources', () => {
    const rows = incomeRows();
    expect(rows).toHaveLength(6);
    for (const r of rows) expect(r.after.xp).toBeGreaterThan(0);
  });

  it('tribulation tiers keep the current numbers until Bill signs off', () => {
    expect(TRIBULATION_TIERS).toMatchObject({
      loi: { passXp: 500, passPills: 5, failXp: 100 },
      phong: { passXp: 900, passPills: 8, failXp: 150 },
      tam_ma: { passXp: 1800, passPills: 15, failXp: 250 },
      cuu_thien: { passXp: 4000, passPills: 30, failXp: 400 },
    });
  });
});
