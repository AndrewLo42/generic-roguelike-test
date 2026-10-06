import { describe, expect, it } from 'vitest';
import { createCombatWorld, type CombatWorld } from '../combat/world';
import { ENEMIES } from '../data/enemies';
import { SKILL_LIBRARY as L } from '../data/skills';
import { computeStats } from '../data/boons';
import { CLASSES } from '../data/classes';
import { applyStatus, stacksOf, tickStatuses } from '../combat/status';
import { fieldAt, handleCombatInput, triggerCombo, updateCombat } from './combat';
import { createPlayer } from './player';
import { generateDungeon, roomCenter } from '../world/dungeon/generator';
import { tileToWorld } from '../world/dungeon/meshBuilder';

const d = generateDungeon(42);
const [cx, cy] = roomCenter(d.rooms[d.startRoom]);
const c = tileToWorld(cx, cy);

function setup(traits: (string | null)[] = []) {
  const cls = CLASSES[0];
  const stats = computeStats({}, cls, [], {}, traits);
  const p = createPlayer(c.x, c.z, stats);
  const w = createCombatWorld(100, 200, cls.weapons[0].kit);
  return { p, w };
}

function addEnemy(w: CombatWorld, x: number, z: number) {
  const e = {
    id: w.nextId++, def: ENEMIES.grunt, x, z, prevX: x, prevZ: z, facing: 0, hp: 500, maxHp: 500, damageMul: 1,
    state: 'chase' as const, timer: 0, hitFlash: 0, room: 0, status: {},
  };
  w.enemies.push(e);
  return e;
}

const field = (w: CombatWorld, element: 'fire' | 'ice' | 'light' | 'arcane') =>
  w.fields.push({ id: w.nextId++, x: c.x, z: c.z, r: 3, element, remaining: 5, duration: 5, pulse: 0 });

describe('status effects', () => {
  it('stacks up to the cap, refreshes duration, and expires', () => {
    const m = {};
    applyStatus(m, 'might', 10, 2);
    applyStatus(m, 'might', 10, 5);
    expect(stacksOf(m, 'might')).toBe(15); // cap
    tickStatuses(m, 4.9);
    expect(stacksOf(m, 'might')).toBe(15);
    tickStatuses(m, 0.2);
    expect(stacksOf(m, 'might')).toBe(0);
  });

  it('burning ticks damage once per second', () => {
    const { p, w } = setup();
    const e = addEnemy(w, c.x + 10, c.z);
    applyStatus(e.status, 'burning', 2, 3);
    for (let i = 0; i < 60; i++) updateCombat(w, p, d, 1 / 60);
    expect(e.hp).toBeLessThan(500);
    expect(500 - e.hp).toBeGreaterThanOrEqual(8); // 2 stacks × 4 dps, ±crit-free
  });
});

describe('combos', () => {
  it('finds the newest field at a point', () => {
    const { w } = setup();
    field(w, 'fire');
    field(w, 'ice');
    expect(fieldAt(w, c.x, c.z)?.element).toBe('ice');
    expect(fieldAt(w, c.x + 10, c.z)).toBeUndefined();
  });

  it('fire + blast grants Might; ice + blast grants Protection; light + blast heals', () => {
    const { p, w } = setup();
    triggerCombo(w, p, 'fire', 'blast', c.x, c.z);
    expect(stacksOf(w.playerStatus, 'might')).toBe(3);
    triggerCombo(w, p, 'ice', 'blast', c.x, c.z);
    expect(stacksOf(w.playerStatus, 'protection')).toBe(1);
    const hp = w.hp;
    triggerCombo(w, p, 'light', 'blast', c.x, c.z);
    expect(w.hp).toBeGreaterThan(hp);
  });

  it('fire + leap burns nearby enemies; whirl sprays bolts', () => {
    const { p, w } = setup();
    const near = addEnemy(w, c.x + 1, c.z);
    const far = addEnemy(w, c.x + 15, c.z);
    triggerCombo(w, p, 'fire', 'leap', c.x, c.z);
    expect(stacksOf(near.status, 'burning')).toBe(3);
    expect(stacksOf(far.status, 'burning')).toBe(0);
    triggerCombo(w, p, 'arcane', 'whirl', c.x, c.z);
    expect(w.projectiles.filter((pr) => pr.comboBolt && pr.combo === 'arcane').length).toBe(6);
  });

  it('projectiles pick up the element of a field they fly through', () => {
    const { p, w } = setup();
    field(w, 'fire');
    const e = addEnemy(w, c.x + 5, c.z);
    w.projectiles.push({
      id: 99, x: c.x - 1, z: c.z, prevX: c.x - 1, prevZ: c.z, dirX: 1, dirZ: 0, speed: 20, damage: 5, radius: 0.3,
      life: 2, targetId: null, skill: L.longShot,
    });
    for (let i = 0; i < 30; i++) updateCombat(w, p, d, 1 / 60);
    expect(stacksOf(e.status, 'burning')).toBeGreaterThanOrEqual(2);
  });

  it('a finisher that lays its own field combos with the field already there, not itself', () => {
    const { p, w } = setup();
    w.kit = [L.arcaneBolt, L.flameBurst, L.meteor, L.frostNova, L.blink];
    w.cooldowns = w.kit.map(() => 0);
    field(w, 'fire'); // e.g. Meteor's fire field under the player
    const pressed = new Set(['Digit4']);
    const input = { isDown: () => false, wasPressed: (k: string) => pressed.has(k) } as unknown as Parameters<typeof handleCombatInput>[2];
    handleCombatInput(w, p, input, d, 0);
    for (let i = 0; i < 30; i++) updateCombat(w, p, d, 1 / 60); // 0.2s cast
    expect(stacksOf(w.playerStatus, 'might')).toBe(3); // Fire Blast
    expect(stacksOf(w.playerStatus, 'protection')).toBe(0); // not Frost Armor from its own ice field
    expect(w.fields.some((f) => f.element === 'ice')).toBe(true); // its own field still appears
  });

  it('traits scale combos and add riders', () => {
    const { p, w } = setup([null, null, 'comboAdept', 'warlord']);
    triggerCombo(w, p, 'fire', 'blast', c.x, c.z);
    // 3 × 1.5 potency = 5 (rounded) + 2 from Warlord
    expect(stacksOf(w.playerStatus, 'might')).toBe(7);
  });

  it('Might and Vulnerability increase damage dealt', () => {
    const { p, w } = setup();
    p.stats.critChance = 0;
    const a = addEnemy(w, c.x + 20, c.z);
    const b = addEnemy(w, c.x + 20, c.z + 3);
    applyStatus(b.status, 'vulnerability', 10, 10);
    applyStatus(w.playerStatus, 'might', 10, 10);
    // Use the fire-leap combo path? Simpler: burning ignores family but uses might/vuln.
    applyStatus(a.status, 'burning', 1, 1.5);
    applyStatus(b.status, 'burning', 1, 1.5);
    for (let i = 0; i < 61; i++) updateCombat(w, p, d, 1 / 60);
    expect(500 - b.hp).toBeGreaterThan(500 - a.hp);
  });
});
