import { describe, expect, it } from 'vitest';
import { createCombatWorld, type CombatWorld } from '../combat/world';
import { ENEMIES } from '../data/enemies';
import { SKILL_LIBRARY as L, type SkillDef } from '../data/skills';
import { computeStats } from '../data/boons';
import { classById } from '../data/classes';
import { applyStatus, has, stacksOf } from '../combat/status';
import { handleCombatInput, isBehind, triggerCombo, updateCombat } from './combat';
import { FlowField, updateEnemies } from './enemies';
import { createPlayer, updatePlayer } from './player';
import type { Input } from '../core/input';
import { generateDungeon, roomCenter } from '../world/dungeon/generator';
import { tileToWorld } from '../world/dungeon/meshBuilder';

const d = generateDungeon(42);
const [cx, cy] = roomCenter(d.rooms[d.startRoom]);
const c = tileToWorld(cx, cy);
const rogue = classById('rogue')!;

function setup(kit: SkillDef[] = rogue.weapons[0].kit) {
  const stats = computeStats({}, rogue);
  stats.critChance = 0;
  const p = createPlayer(c.x, c.z, stats);
  const w = createCombatWorld(200, 200, kit);
  return { p, w };
}

function addEnemy(w: CombatWorld, x: number, z: number, facing = 0) {
  const e = {
    id: w.nextId++, def: ENEMIES.grunt, x, z, prevX: x, prevZ: z, facing, hp: 1000, maxHp: 1000, damageMul: 1,
    state: 'chase' as const, timer: 0, hitFlash: 0, room: 0, status: {},
  };
  w.enemies.push(e);
  return e;
}

const keys = (...k: string[]) => {
  const s = new Set(k);
  return { isDown: () => false, wasPressed: (x: string) => s.has(x), rmb: false, mouseDX: 0, mouseDY: 0, wheel: 0 } as unknown as Input;
};

/** Press a skill key and run ~0.5s of combat. */
function cast(w: CombatWorld, p: ReturnType<typeof createPlayer>, slot: number) {
  handleCombatInput(w, p, keys(`Digit${slot}`), d, 0);
  for (let i = 0; i < 30; i++) updateCombat(w, p, d, 1 / 60);
}

describe('rogue', () => {
  it('passive applies backstab and ambush bonuses', () => {
    const s = computeStats({}, rogue);
    expect(s.backstabBonus).toBeCloseTo(0.3);
    expect(s.ambushBonus).toBeCloseTo(0.8); // 0.3 base + 0.5 passive
  });

  it('isBehind uses the enemy facing', () => {
    const { w } = setup();
    const e = addEnemy(w, 0, 0, 0); // facing +Z
    expect(isBehind(e, 0, -2)).toBe(true);
    expect(isBehind(e, 0, 2)).toBe(false);
    expect(isBehind(e, 2, 0)).toBe(false); // flank isn't behind
  });

  it('Backstab hits much harder from behind', () => {
    const front = setup([L.twinStrikes, L.backstab]);
    const ef = addEnemy(front.w, c.x, c.z + 1.5, Math.PI); // facing the player
    front.p.facing = 0;
    cast(front.w, front.p, 2);
    const back = setup([L.twinStrikes, L.backstab]);
    const eb = addEnemy(back.w, c.x, c.z + 1.5, 0); // facing away from the player
    back.p.facing = 0;
    cast(back.w, back.p, 2);
    const frontDmg = 1000 - ef.hp, backDmg = 1000 - eb.hp;
    expect(frontDmg).toBe(26);
    expect(backDmg).toBe(Math.round(26 * (1 + 0.3 + 0.6)));
  });

  it('attacking from Stealth is an Ambush and breaks Stealth', () => {
    const { p, w } = setup([L.twinStrikes, L.backstab]);
    const e = addEnemy(w, c.x, c.z + 1.5, Math.PI);
    applyStatus(w.playerStatus, 'stealth', 1, 5);
    cast(w, p, 2);
    expect(1000 - e.hp).toBe(Math.round(26 * 1.8));
    expect(has(w.playerStatus, 'stealth')).toBe(false);
  });

  it('smoke + blast grants Stealth; smoke + projectile/whirl Blinds', () => {
    const { p, w } = setup();
    triggerCombo(w, p, 'smoke', 'blast', c.x, c.z);
    expect(has(w.playerStatus, 'stealth')).toBe(true);
    triggerCombo(w, p, 'smoke', 'whirl', c.x, c.z);
    expect(w.projectiles.filter((pr) => pr.combo === 'smoke').length).toBe(6);
  });

  it('a Blinded enemy\'s attack misses and the Blind is consumed', () => {
    const { p, w } = setup();
    const e = addEnemy(w, c.x, c.z + 1.5, Math.PI);
    applyStatus(e.status, 'blind', 1, 5);
    w.telegraphs.push({ id: 99, shape: { kind: 'circle', x: p.x, z: p.z, r: 3 }, duration: 0.1, elapsed: 0, hostile: true, damage: 50, ownerId: e.id });
    for (let i = 0; i < 10; i++) updateCombat(w, p, d, 1 / 60);
    expect(w.hp).toBe(200);
    expect(has(e.status, 'blind')).toBe(false);
  });

  it('poison ticks damage', () => {
    const { p, w } = setup();
    const e = addEnemy(w, c.x + 15, c.z);
    applyStatus(e.status, 'poison', 4, 3);
    for (let i = 0; i < 61; i++) updateCombat(w, p, d, 1 / 60);
    expect(1000 - e.hp).toBe(10); // 4 stacks × 2.5/s
  });

  it('enemies do not notice or chase a stealthed player', () => {
    const { p, w } = setup();
    const flow = new FlowField(d);
    const idle = addEnemy(w, c.x + 4, c.z);
    idle.state = 'idle' as never;
    const chaser = addEnemy(w, c.x - 4, c.z);
    applyStatus(w.playerStatus, 'stealth', 1, 5);
    const x0 = chaser.x;
    for (let i = 0; i < 30; i++) updateEnemies(w, p, d, flow, 1 / 60);
    expect(idle.state).toBe('idle');
    expect(chaser.x).toBe(x0);
    expect(w.telegraphs.length).toBe(0);
  });

  it('Shadowstep lands behind the target, facing its back', () => {
    const { p, w } = setup([L.twinStrikes, L.shadowstep]);
    const e = addEnemy(w, c.x, c.z + 5, Math.PI); // facing the player (−Z)
    w.targetId = e.id;
    w.hardTargetId = e.id;
    handleCombatInput(w, p, keys('Digit2'), d, 0);
    for (let i = 0; i < 20; i++) {
      updatePlayer(p, keys(), 0, false, false, d, 1 / 60);
      updateCombat(w, p, d, 1 / 60);
    }
    expect(isBehind(e, p.x, p.z)).toBe(true);
    expect(stacksOf(w.playerStatus, 'regeneration')).toBe(1);
  });

  it('a chasing enemy does not turn around during Shadowstep, so Backstab lands from behind', () => {
    const { p, w } = setup([L.twinStrikes, L.shadowstep, L.backstab]);
    const flow = new FlowField(d);
    const e = addEnemy(w, c.x, c.z + 6, Math.PI); // chasing, facing the player
    w.targetId = w.hardTargetId = e.id;
    const tick = (input: Input) => {
      handleCombatInput(w, p, input, d, 0);
      updatePlayer(p, input, 0, false, false, d, 1 / 60, null);
      updateEnemies(w, p, d, flow, 1 / 60);
      updateCombat(w, p, d, 1 / 60);
    };
    tick(keys('Digit2'));
    for (let i = 0; i < 15; i++) tick(keys());
    expect(isBehind(e, p.x, p.z)).toBe(true);
    expect(has(w.playerStatus, 'stealth')).toBe(true);
    const hp = e.hp;
    tick(keys('Digit3'));
    for (let i = 0; i < 30; i++) tick(keys());
    // 26 base × (1 + 0.3 passive + 0.6 Backstab skill) × (1 + 0.8 Ambush)
    expect(hp - e.hp).toBe(Math.round(26 * 1.9 * 1.8));
  });
});
