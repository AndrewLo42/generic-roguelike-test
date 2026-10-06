import { describe, expect, it } from 'vitest';
import { createCombatWorld, type CombatWorld } from '../combat/world';
import { ENEMIES } from '../data/enemies';
import { computeStats } from '../data/boons';
import { CLASSES } from '../data/classes';
import { has } from '../combat/status';
import { castFacing, handleCombatInput, updateCombat } from './combat';
import { createPlayer, updatePlayer } from './player';
import type { Input } from '../core/input';
import { generateDungeon, roomCenter } from '../world/dungeon/generator';
import { tileToWorld } from '../world/dungeon/meshBuilder';

const d = generateDungeon(42);
const [cx, cy] = roomCenter(d.rooms[d.startRoom]);
const c = tileToWorld(cx, cy);

const keys = (...k: string[]) => {
  const s = new Set(k);
  return { isDown: (x: string) => s.has(x), wasPressed: (x: string) => s.has(x), rmb: false, mouseDX: 0, mouseDY: 0, wheel: 0 } as unknown as Input;
};

function addEnemy(w: CombatWorld, x: number, z: number) {
  const e = {
    id: w.nextId++, def: ENEMIES.grunt, x, z, prevX: x, prevZ: z, facing: Math.PI, hp: 1000, maxHp: 1000, damageMul: 1,
    state: 'chase' as const, timer: 0, hitFlash: 0, room: 0, status: {},
  };
  w.enemies.push(e);
  return e;
}

describe('every weapon skill works in the combat sim', () => {
  for (const cls of CLASSES) for (const weapon of cls.weapons) for (const skill of weapon.skills) {
    it(`${cls.id} · ${weapon.id} · ${skill.id}`, () => {
      const stats = computeStats({}, cls);
      const p = createPlayer(c.x, c.z, stats);
      p.facing = 0;
      const w = createCombatWorld(200, 200, [skill]);
      // Forward leaps strike where they land, so put the enemy there.
      const e = addEnemy(w, c.x, c.z + (skill.leapMode === 'forward' ? skill.range : 2.2));
      w.hardTargetId = e.id;
      handleCombatInput(w, p, keys('Digit1'), d, 0);
      for (let i = 0; i < 150; i++) {
        updatePlayer(p, keys(), 0, false, false, d, 1 / 60, castFacing(w, p));
        updateCombat(w, p, d, 1 / 60);
      }
      if (skill.damage > 0) expect(e.hp, 'deals damage').toBeLessThan(1000);
      for (const st of skill.statuses ?? []) expect(has(e.status, st.id) || st.duration < 2.5, `applies ${st.id}`).toBe(true);
      if (skill.field) expect(w.fields.some((f) => f.element === skill.field!.element), 'leaves its field').toBe(true);
      if (skill.cooldown > 0) expect(w.cooldowns[0], 'goes on cooldown').toBeGreaterThan(0);
    });
  }
});
