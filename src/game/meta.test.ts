import { describe, expect, it } from 'vitest';
import { BASE_STATS } from '../combat/stats';
import { META_UPGRADES, applyMeta, metaById, shardsForRun, upgradeCost } from '../data/meta';
import { buyRank, emptySave, loadMeta, recordRun, refundAll, saveMeta } from './metaSave';

const run = { classId: 'warrior', floor: 4, kills: 20, bruteKills: 3, chests: 2, goldChests: 1 };

describe('meta progression', () => {
  it('costs grow with rank', () => {
    const def = metaById('might')!;
    expect(upgradeCost(def, 0)).toBe(15);
    expect(upgradeCost(def, 1)).toBeGreaterThan(upgradeCost(def, 0));
    expect(upgradeCost(def, 5)).toBeGreaterThan(upgradeCost(def, 4));
  });

  it('buyRank spends shards and respects max rank', () => {
    const s = emptySave();
    s.shards = 1000;
    expect(buyRank(s, 'undying')).toBe(true);
    expect(buyRank(s, 'undying')).toBe(false); // max rank 1
    expect(s.shards).toBe(1000 - 150);
    s.shards = 0;
    expect(buyRank(s, 'might')).toBe(false); // can't afford
  });

  it('refundAll returns everything spent', () => {
    const s = emptySave();
    s.shards = 500;
    buyRank(s, 'might'); buyRank(s, 'might'); buyRank(s, 'vitality');
    refundAll(s);
    expect(s.shards).toBe(500);
    expect(s.ranks).toEqual({});
  });

  it('applyMeta folds ranks into stats', () => {
    const st = { ...BASE_STATS };
    applyMeta(st, { might: 2, fortitude: 3, vitality: 1 });
    expect(st.damageMul).toBeCloseTo(1.1);
    expect(st.armor).toBe(18);
    expect(st.maxHpMul).toBeCloseTo(1.06);
  });

  it('shards scale with depth, kills, chests and Fortune', () => {
    const base = shardsForRun(run, {}).total;
    // floors 1..3 cleared: 15+20+25 = 60; kills 20 + 3*2 = 26; chests 4 + 10 = 14
    expect(base).toBe(100);
    expect(shardsForRun(run, { fortune: 2 }).total).toBe(120);
    expect(shardsForRun({ ...run, floor: 1, kills: 0, bruteKills: 0, chests: 0, goldChests: 0 }, {}).total).toBe(0);
  });

  it('save round-trips and survives garbage', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const s = emptySave();
    recordRun(s, 42, 5, 30);
    s.ranks.might = 2;
    saveMeta(s, storage);
    const loaded = loadMeta(storage);
    expect(loaded.shards).toBe(42);
    expect(loaded.ranks.might).toBe(2);
    expect(loaded.stats.bestFloor).toBe(5);
    mem.set([...mem.keys()][0], '{not json');
    expect(loadMeta(storage)).toEqual(emptySave());
  });

  it('every upgrade has a sane definition', () => {
    for (const u of META_UPGRADES) {
      expect(u.maxRank).toBeGreaterThan(0);
      expect(u.effect(1).length).toBeGreaterThan(0);
    }
  });
});
