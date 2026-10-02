import { describe, expect, it } from 'vitest';
import { BOONS, computeStats, rollOffers } from './boons';
import { BASE_STATS, maxHpOf } from '../combat/stats';
import { CLASSES, kitKinds } from './classes';

describe('boons', () => {
  it('computeStats applies each stack', () => {
    const s = computeStats({ edge: 2, vitality: 1, focus: 2 });
    expect(s.damageMul).toBeCloseTo(1.24);
    expect(maxHpOf(s)).toBe(240);
    expect(s.cooldownMul).toBeCloseTo(0.81);
  });

  it('class sets base HP and speed', () => {
    const warrior = CLASSES.find((c) => c.id === 'warrior')!;
    const s = computeStats({ vitality: 1 }, warrior);
    expect(maxHpOf(s)).toBe(warrior.baseHp + 40);
  });

  it('only offers boons that fit the class kit', () => {
    const warrior = CLASSES.find((c) => c.id === 'warrior')!;
    for (let seed = 0; seed < 50; seed++) {
      const ids = rollOffers(seed, {}, 4, kitKinds(warrior)).map((b) => b.id);
      expect(ids).not.toContain('split'); // no projectile skills in the warrior pool
    }
  });

  it('computeStats does not mutate the base', () => {
    computeStats({ edge: 5, glass: 1 });
    expect(BASE_STATS.damageMul).toBe(1);
  });

  it('offers are distinct, deterministic per seed, and never include maxed boons', () => {
    const a = rollOffers(99, {}, 4);
    expect(new Set(a.map((b) => b.id)).size).toBe(4);
    expect(rollOffers(99, {}, 4).map((b) => b.id)).toEqual(a.map((b) => b.id));

    const allMaxedButTwo = Object.fromEntries(BOONS.slice(2).map((b) => [b.id, b.maxStacks]));
    const offers = rollOffers(5, allMaxedButTwo, 3);
    expect(offers.map((b) => b.id).sort()).toEqual([BOONS[0].id, BOONS[1].id].sort());
  });
});
