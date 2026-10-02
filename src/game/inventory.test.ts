import { describe, expect, it } from 'vitest';
import { Rng } from '../core/rng';
import { BASE_STATS } from '../combat/stats';
import { applyGear, generateGear, makePotion, MAX_POTION_STACK } from '../data/items';
import { BAG_SIZE, addItem, consumePotion, createInventory, equipFromBag, potionCount, unequip } from './inventory';

const rng = () => new Rng(123);

describe('inventory', () => {
  it('starts with stacked potions', () => {
    const inv = createInventory(2);
    expect(potionCount(inv)).toBe(2);
    addItem(inv, makePotion(3));
    expect(potionCount(inv)).toBe(5);
    expect(inv.bag.filter(Boolean).length).toBe(1); // merged into one stack
  });

  it('potion stacks overflow into a new slot at the cap', () => {
    const inv = createInventory(0);
    addItem(inv, makePotion(MAX_POTION_STACK));
    addItem(inv, makePotion(3));
    expect(inv.bag.filter(Boolean).length).toBe(2);
    expect(potionCount(inv)).toBe(MAX_POTION_STACK + 3);
  });

  it('equip swaps with the currently equipped item', () => {
    const inv = createInventory(0);
    const a = generateGear(rng(), 1, 'warrior', 'magic', 'weapon');
    const b = generateGear(rng(), 1, 'warrior', 'rare', 'weapon');
    addItem(inv, a);
    addItem(inv, b);
    equipFromBag(inv, 0);
    expect(inv.equipped.weapon).toBe(a);
    equipFromBag(inv, 1);
    expect(inv.equipped.weapon).toBe(b);
    expect(inv.bag[1]).toBe(a);
  });

  it('cannot add or unequip into a full bag', () => {
    const inv = createInventory(0);
    for (let i = 0; i < BAG_SIZE; i++) expect(addItem(inv, generateGear(rng(), 1, 'mage', 'common'))).toBe(true);
    expect(addItem(inv, generateGear(rng(), 1, 'mage', 'common'))).toBe(false);
    const g = inv.bag[0]!;
    equipFromBag(inv, 0); // frees slot 0
    addItem(inv, generateGear(rng(), 1, 'mage', 'common')); // fills it again
    expect(unequip(inv, (g as { slot: 'weapon' }).slot)).toBe(false);
  });

  it('consumePotion decrements and clears empty stacks', () => {
    const inv = createInventory(1);
    expect(consumePotion(inv)).toBe(true);
    expect(potionCount(inv)).toBe(0);
    expect(inv.bag.every((x) => x === null)).toBe(true);
    expect(consumePotion(inv)).toBe(false);
  });
});

describe('items', () => {
  it('rarity controls affix count; trinkets get a bonus affix', () => {
    const r = rng();
    expect(generateGear(r, 1, 'warrior', 'common', 'weapon').affixes.length).toBe(1); // implicit only
    expect(generateGear(r, 1, 'warrior', 'epic', 'weapon').affixes.length).toBe(4);
    expect(generateGear(r, 1, 'warrior', 'rare', 'trinket').affixes.length).toBe(3);
  });

  it('affixes on one item are distinct and respect slot restrictions', () => {
    const r = rng();
    for (let i = 0; i < 200; i++) {
      const it = generateGear(r, 5, 'ranger', 'epic', 'weapon');
      const rolled = it.affixes.slice(1).map((a) => a.stat);
      expect(new Set(rolled).size).toBe(rolled.length);
      expect(rolled).not.toContain('moveSpeedPct'); // boots/trinket only
    }
  });

  it('applyGear folds affixes into stats', () => {
    const s = { ...BASE_STATS };
    applyGear(s, [{ uid: 1, kind: 'gear', slot: 'chest', name: 't', icon: '', rarity: 'rare', level: 1,
      affixes: [{ stat: 'armor', value: 20 }, { stat: 'maxHp', value: 30 }, { stat: 'damagePct', value: 10 }] }]);
    expect(s.armor).toBe(20);
    expect(s.bonusMaxHp).toBe(30);
    expect(s.damageMul).toBeCloseTo(1.1);
  });
});
