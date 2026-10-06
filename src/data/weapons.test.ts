import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { CLASSES, kitKinds, poolFor, resolveLoadout } from './classes';
import { generateGear, makeStarterWeapon } from './items';
import { CLASS_WEAPONS, weaponFor } from './weapons';
import { createCombatWorld } from '../combat/world';

describe('weapons', () => {
  it('every class has at least two weapons with a full, valid default kit', () => {
    for (const c of CLASSES) {
      expect(c.weapons.length).toBeGreaterThanOrEqual(2);
      for (const w of c.weapons) {
        expect(w.kit).toHaveLength(5);
        const pool = poolFor(c, w).map((s) => s.id);
        for (const s of w.kit) expect(pool).toContain(s.id);
        expect(new Set(w.kit.map((s) => s.id)).size).toBe(5); // no duplicates
      }
    }
  });

  it('weapon skills are exclusive to their weapon; utilities are shared', () => {
    for (const c of CLASSES) {
      const [a, b] = c.weapons;
      const aIds = new Set(a.skills.map((s) => s.id));
      for (const s of b.skills) expect(aIds.has(s.id)).toBe(false);
      for (const u of c.utilities) {
        expect(poolFor(c, a)).toContain(u);
        expect(poolFor(c, b)).toContain(u);
      }
    }
  });

  it('loadouts resolve per weapon: other-weapon skills fall back to that weapon’s default', () => {
    const warrior = CLASSES.find((c) => c.id === 'warrior')!;
    const [gs, sns] = warrior.weapons;
    // A greatsword loadout applied to sword & shield: Cleave isn't allowed, Warhorn (utility) is.
    const ids = ['cleave', 'savageLeap', 'whirl', 'flameBrand', 'warhorn'];
    expect(resolveLoadout(warrior, gs, ids).map((s) => s.id)).toEqual(ids);
    expect(resolveLoadout(warrior, sns, ids).map((s) => s.id)).toEqual(['swordSlash', 'lunge', 'shieldBash', 'flameBrand', 'warhorn']);
  });

  it('dropped weapons roll a weapon type of the class, named after it', () => {
    const rng = new Rng(9);
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const g = generateGear(rng, 2, 'rogue', 'magic', 'weapon');
      const w = weaponFor('rogue', g.weaponType);
      expect(w.id).toBe(g.weaponType);
      expect(w.baseNames.some((n) => g.name.endsWith(n))).toBe(true);
      seen.add(w.id);
    }
    expect(seen).toEqual(new Set(CLASS_WEAPONS.rogue.map((w) => w.id)));
    expect(generateGear(rng, 2, 'rogue', 'magic', 'head').weaponType).toBeUndefined();
  });

  it('starter weapons have no stats and the right type', () => {
    const s = makeStarterWeapon('mage', 'wandTome');
    expect(s.affixes).toEqual([]);
    expect(s.weaponType).toBe('wandTome');
    expect(s.slot).toBe('weapon');
  });

  it('boon filtering follows the equipped weapon', () => {
    const warrior = CLASSES.find((c) => c.id === 'warrior')!;
    expect(kitKinds(warrior).has('projectile')).toBe(false); // greatsword
    expect(kitKinds(warrior, warrior.weapons[1]).has('projectile')).toBe(true); // shield throw
  });

  it('every new weapon kit can be loaded into a combat world', () => {
    for (const c of CLASSES) for (const w of c.weapons) {
      const world = createCombatWorld(100, 100, w.kit);
      expect(world.kit).toHaveLength(5);
    }
  });
});
