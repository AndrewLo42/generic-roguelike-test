import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { CLASSES, UTILITY_SLOTS, WEAPON_SLOTS, kitKinds, resolveUtilities, resolveWeaponSkills } from './classes';
import { generateGear, makeStarterWeapon } from './items';
import { CLASS_WEAPONS, weaponFor } from './weapons';
import { createCombatWorld } from '../combat/world';

describe('weapons', () => {
  it('every class has two+ weapons with a full kit of their own skills, and a utility kit', () => {
    for (const c of CLASSES) {
      expect(c.weapons.length).toBeGreaterThanOrEqual(2);
      for (const w of c.weapons) {
        expect(w.kit).toHaveLength(WEAPON_SLOTS);
        for (const s of w.kit) expect(w.skills).toContain(s);
        expect(new Set(w.kit).size).toBe(WEAPON_SLOTS);
      }
      expect(c.utilityKit).toHaveLength(UTILITY_SLOTS);
      for (const s of c.utilityKit) expect(c.utilities).toContain(s);
    }
  });

  it('weapon skills are exclusive to their weapon and never utilities', () => {
    for (const c of CLASSES) {
      const [a, b] = c.weapons;
      for (const s of b.skills) expect(a.skills).not.toContain(s);
      for (const w of c.weapons) for (const s of w.skills) expect(c.utilities).not.toContain(s);
    }
  });

  it('saved weapon loadouts resolve per weapon; invalid or duplicate ids fall back without duplicates', () => {
    const warrior = CLASSES.find((c) => c.id === 'warrior')!;
    const [gs, sns] = warrior.weapons;
    const ids = ['heavyStrike', 'whirl', 'cleave', 'savageLeap', 'earthshaker'];
    expect(resolveWeaponSkills(gs, ids).map((s) => s.id)).toEqual(ids);
    // Old-style saves mixed utilities into slots 1–5; greatsword ids are invalid for sword & shield.
    const old = ['cleave', 'savageLeap', 'whirl', 'flameBrand', 'warhorn'];
    expect(resolveWeaponSkills(gs, old).map((s) => s.id)).toEqual(['cleave', 'savageLeap', 'whirl', 'earthshaker', 'chargingStrike']);
    expect(resolveWeaponSkills(sns, old)).toEqual(sns.kit);
    const dup = resolveWeaponSkills(gs, ['whirl', 'whirl', 'whirl']);
    expect(new Set(dup.map((s) => s.id)).size).toBe(WEAPON_SLOTS);
    expect(dup[0].id).toBe('whirl');
  });

  it('utility loadouts resolve against the class utilities', () => {
    const rogue = CLASSES.find((c) => c.id === 'rogue')!;
    expect(resolveUtilities(rogue, ['adrenaline', 'fanOfKnives', 'vanish']).map((s) => s.id)).toEqual(['adrenaline', 'fanOfKnives', 'vanish']);
    expect(resolveUtilities(rogue, ['twinStrikes'])).toEqual(rogue.utilityKit); // weapon skill: not allowed
    expect(resolveUtilities(rogue)).toEqual(rogue.utilityKit);
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

  it('boon filtering follows the held weapon sets', () => {
    const warrior = CLASSES.find((c) => c.id === 'warrior')!;
    expect(kitKinds(warrior).has('projectile')).toBe(false); // greatsword only
    expect(kitKinds(warrior, warrior.weapons).has('projectile')).toBe(true); // + shield throw
  });

  it('a full bar (5 weapon + 3 utility) loads into a combat world', () => {
    for (const c of CLASSES) for (const w of c.weapons) {
      const world = createCombatWorld(100, 100, [...w.kit, ...c.utilityKit]);
      expect(world.kit).toHaveLength(WEAPON_SLOTS + UTILITY_SLOTS);
    }
  });
});
