import { Rng } from '../core/rng';
import { ENEMIES, type EnemyDef } from '../data/enemies';
import { type Dungeon, isFloor } from '../world/dungeon/generator';
import { TILE } from '../world/dungeon/meshBuilder';
import { hasLineOfSight, resolveCircleVsWalls } from '../world/collision';
import type { CombatWorld, Enemy } from '../combat/world';
import type { Shape } from '../combat/shapes';
import { CHILL_SLOW, has } from '../combat/status';
import { playerTuning, type PlayerState } from './player';

// ---------- Spawning ----------

/** Deterministic per seed: 2–4 enemies (more on deeper floors) in every room except the start. */
export function spawnEnemies(w: CombatWorld, d: Dungeon, floor: number) {
  const rng = new Rng(d.seed * 31 + 7);
  const scale = 1 + 0.15 * (floor - 1);
  d.rooms.forEach((room, ri) => {
    if (ri === d.startRoom) return;
    const count = rng.int(2, 3) + Math.min(3, Math.floor((floor - 1) / 2));
    for (let i = 0; i < count; i++) {
      const roll = rng.next();
      const bruteChance = Math.min(0.3, 0.08 + 0.04 * floor);
      const def: EnemyDef = roll < bruteChance ? ENEMIES.brute : roll < bruteChance + 0.25 ? ENEMIES.caster : ENEMIES.grunt;
      const x = (room.x + 1 + rng.next() * (room.w - 2)) * TILE;
      const z = (room.y + 1 + rng.next() * (room.h - 2)) * TILE;
      const hp = Math.round(def.hp * scale);
      w.enemies.push({
        id: w.nextId++, def, x, z, prevX: x, prevZ: z, facing: rng.next() * Math.PI * 2,
        hp, maxHp: hp, damageMul: 1 + 0.1 * (floor - 1),
        state: 'idle', timer: 0, hitFlash: 0, room: ri, status: {},
      });
    }
  });
}

// ---------- Pathing: BFS flow field from the player's tile ----------

/** Distance-to-player per tile; enemies walk downhill. Recomputed only when the player changes tile. */
export class FlowField {
  dist: Int32Array;
  private lastTile = -1;

  constructor(private d: Dungeon) {
    this.dist = new Int32Array(d.width * d.height).fill(-1);
  }

  update(px: number, pz: number) {
    const d = this.d;
    const tx = Math.floor(px / TILE), ty = Math.floor(pz / TILE);
    const start = ty * d.width + tx;
    if (start === this.lastTile || !isFloor(d, tx, ty)) return;
    this.lastTile = start;
    this.dist.fill(-1);
    this.dist[start] = 0;
    const queue = [start];
    for (let qi = 0; qi < queue.length; qi++) {
      const cur = queue[qi];
      const cx = cur % d.width, cy = (cur - cx) / d.width;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + ox, ny = cy + oy, k = ny * d.width + nx;
        if (isFloor(d, nx, ny) && this.dist[k] < 0) {
          this.dist[k] = this.dist[cur] + 1;
          queue.push(k);
        }
      }
    }
  }

  /** World-space point of the next tile toward the player, or null if unreachable. */
  nextStep(x: number, z: number): [number, number] | null {
    const d = this.d;
    const tx = Math.floor(x / TILE), ty = Math.floor(z / TILE);
    const here = this.dist[ty * d.width + tx];
    let best: [number, number] | null = null;
    let bestD = here < 0 ? Infinity : here;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const nx = tx + ox, ny = ty + oy;
        if (!isFloor(d, nx, ny)) continue;
        // No diagonal corner-cutting.
        if (ox && oy && (!isFloor(d, tx + ox, ty) || !isFloor(d, tx, ty + oy))) continue;
        const nd = this.dist[ny * d.width + nx];
        if (nd >= 0 && nd < bestD) { bestD = nd; best = [(nx + 0.5) * TILE, (ny + 0.5) * TILE]; }
      }
    }
    return best;
  }
}

// ---------- AI ----------

function buildAttackShape(e: Enemy, p: PlayerState): Shape {
  const a = e.def.attack;
  if (a.shape === 'cone') return { kind: 'cone', x: e.x, z: e.z, dir: e.facing, range: a.range, arc: a.arc ?? Math.PI / 2 };
  if (a.shape === 'selfCircle') return { kind: 'circle', x: e.x, z: e.z, r: a.range };
  return { kind: 'circle', x: p.x, z: p.z, r: a.range };
}

export function aggro(w: CombatWorld, e: Enemy) {
  if (e.state !== 'idle') return;
  e.state = 'chase';
  // Pack pull: roommates join in.
  for (const o of w.enemies) {
    if (o.state === 'idle' && o.room === e.room) o.state = 'chase';
  }
}

export function updateEnemies(w: CombatWorld, p: PlayerState, d: Dungeon, flow: FlowField, dt: number) {
  flow.update(p.x, p.z);

  const hidden = has(w.playerStatus, 'stealth');
  for (const e of w.enemies) {
    e.prevX = e.x;
    e.prevZ = e.z;
    e.hitFlash = Math.max(0, e.hitFlash - dt);
    const dx = p.x - e.x, dz = p.z - e.z;
    const dist = Math.hypot(dx, dz);
    const los = dist < 30 && hasLineOfSight(d, e.x, e.z, p.x, p.z);

    switch (e.state) {
      case 'idle':
        if (!w.dead && !hidden && dist < e.def.aggroRange && los) aggro(w, e);
        break;

      case 'chase': {
        if (w.dead) { e.state = 'idle'; break; }
        // Stealth: they've lost you — hold position, keep facing where they were looking
        // (which is how a Rogue slips behind them), and don't start new attacks.
        if (hidden) break;
        e.facing = Math.atan2(dx, dz);
        if (los && dist <= e.def.attackRange + playerTuning.radius) {
          e.state = 'windup';
          e.timer = e.def.attack.windup;
          w.telegraphs.push({
            id: w.nextId++, shape: buildAttackShape(e, p), duration: e.def.attack.windup, elapsed: 0,
            hostile: true, damage: Math.round(e.def.attack.damage * e.damageMul), ownerId: e.id,
          });
          break;
        }
        let tx = p.x, tz = p.z;
        if (!los) {
          const step = flow.nextStep(e.x, e.z);
          if (!step) break;
          [tx, tz] = step;
        }
        const mx = tx - e.x, mz = tz - e.z, ml = Math.hypot(mx, mz) || 1;
        const speed = e.def.speed * (has(e.status, 'chill') ? CHILL_SLOW : 1);
        e.x += (mx / ml) * speed * dt;
        e.z += (mz / ml) * speed * dt;
        if (!los) e.facing = Math.atan2(mx, mz);
        break;
      }

      case 'windup':
        // Rooted and committed — that's what makes the telegraph dodgeable.
        e.timer -= dt;
        if (e.timer <= 0) { e.state = 'recover'; e.timer = e.def.attack.recover; }
        break;

      case 'recover':
        e.timer -= dt;
        if (e.timer <= 0) e.state = 'chase';
        break;
    }
  }

  // Soft separation between enemies, and from the player.
  const es = w.enemies;
  for (let i = 0; i < es.length; i++) {
    const a = es[i];
    for (let j = i + 1; j < es.length; j++) {
      const b = es[j];
      const dx = b.x - a.x, dz = b.z - a.z;
      const min = a.def.radius + b.def.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 > 0 && d2 < min * min) {
        const dd = Math.sqrt(d2), push = (min - dd) / 2;
        a.x -= (dx / dd) * push; a.z -= (dz / dd) * push;
        b.x += (dx / dd) * push; b.z += (dz / dd) * push;
      }
    }
    const pdx = a.x - p.x, pdz = a.z - p.z, pd = Math.hypot(pdx, pdz);
    const pmin = a.def.radius + playerTuning.radius;
    if (pd > 0 && pd < pmin) { a.x += (pdx / pd) * (pmin - pd); a.z += (pdz / pd) * (pmin - pd); }
    resolveCircleVsWalls(d, a, a.def.radius);
  }
}
