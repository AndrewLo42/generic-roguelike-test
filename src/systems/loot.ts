import { Rng } from '../core/rng';
import { CHEST_RARITY, ENEMY_RARITY, GOLD_CHEST_RARITY, type Item, generateGear, makePotion, rollRarity } from '../data/items';
import type { Dungeon } from '../world/dungeon/generator';
import { TILE } from '../world/dungeon/meshBuilder';
import { isWallAt } from '../world/collision';
import type { Chest, CombatWorld } from '../combat/world';
import { type Inventory, addItem } from '../game/inventory';
import type { PlayerState } from './player';

const POTION_DROP_CHANCE = 0.03;
const PICKUP_RADIUS = 1.3;
export const CHEST_INTERACT_RANGE = 2.4;

/** Drop context for the current floor. */
export interface LootContext {
  rng: Rng;
  floor: number;
  classId: string;
  /** Multiplier on enemy gear drop chance (Scavenger upgrade). */
  dropMul: number;
}

export const createLootContext = (seed: number, floor: number, classId: string, dropMul = 1): LootContext => ({
  rng: new Rng(seed * 7919 + 11), floor, classId, dropMul,
});

/** Place an item near (x, z), scattered a little and kept out of walls. */
function dropAt(w: CombatWorld, d: Dungeon, ctx: LootContext, item: Item, x: number, z: number, spread = 1.2) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const a = ctx.rng.next() * Math.PI * 2, r = spread * (0.4 + ctx.rng.next() * 0.6);
    const lx = x + Math.sin(a) * r, lz = z + Math.cos(a) * r;
    if (!isWallAt(d, lx, lz)) { w.loot.push({ id: w.nextId++, x: lx, z: lz, item, delay: 0.5 }); return; }
  }
  w.loot.push({ id: w.nextId++, x, z, item, delay: 0.5 });
}

/** 1–3 chests (more on deeper floors) tucked into corners of non-start rooms. Deterministic per seed. */
export function spawnChests(w: CombatWorld, d: Dungeon, floor: number) {
  const rng = new Rng(d.seed * 977 + 3);
  const rooms = d.rooms.map((_, i) => i).filter((i) => i !== d.startRoom);
  const count = Math.min(rooms.length, 1 + rng.int(0, floor >= 3 ? 2 : 1));
  for (let n = 0; n < count; n++) {
    const ri = rooms.splice(rng.int(0, rooms.length - 1), 1)[0];
    const r = d.rooms[ri];
    const left = rng.chance(0.5), top = rng.chance(0.5);
    const x = (left ? r.x + 1.2 : r.x + r.w - 1.2) * TILE;
    const z = (top ? r.y + 1.2 : r.y + r.h - 1.2) * TILE;
    const cx = (r.x + r.w / 2) * TILE, cz = (r.y + r.h / 2) * TILE;
    w.chests.push({ id: w.nextId++, x, z, facing: Math.atan2(cx - x, cz - z), opened: false, gold: rng.chance(0.2) });
  }
}

/** Roll drops for everything that died this tick. Returns the kills (for run stats). */
export function rollKillDrops(w: CombatWorld, d: Dungeon, ctx: LootContext): CombatWorld['kills'] {
  const kills = [...w.kills];
  for (const e of kills) {
    if (ctx.rng.chance(e.def.dropChance * ctx.dropMul)) {
      const rarity = rollRarity(ctx.rng, ENEMY_RARITY, ctx.floor);
      dropAt(w, d, ctx, generateGear(ctx.rng, ctx.floor, ctx.classId, rarity), e.x, e.z);
    }
    if (ctx.rng.chance(POTION_DROP_CHANCE)) dropAt(w, d, ctx, makePotion(1), e.x, e.z);
  }
  w.kills.length = 0;
  return kills;
}

/** Chests: 2 guaranteed magic+ items, sometimes a third, occasionally a potion. Gold chests: 3 rare+. */
export function openChest(w: CombatWorld, d: Dungeon, ctx: LootContext, chest: Chest) {
  if (chest.opened) return;
  chest.opened = true;
  // Spill toward the room (in front of the lid).
  const fx = chest.x + Math.sin(chest.facing) * 1.4, fz = chest.z + Math.cos(chest.facing) * 1.4;
  const n = chest.gold ? 3 : 2 + (ctx.rng.chance(0.3) ? 1 : 0);
  const weights = chest.gold ? GOLD_CHEST_RARITY : CHEST_RARITY;
  for (let i = 0; i < n; i++) {
    dropAt(w, d, ctx, generateGear(ctx.rng, ctx.floor, ctx.classId, rollRarity(ctx.rng, weights, ctx.floor)), fx, fz, 1.4);
  }
  if (ctx.rng.chance(0.3)) dropAt(w, d, ctx, makePotion(1), fx, fz, 1.4);
}

export function nearestClosedChest(w: CombatWorld, p: PlayerState): Chest | null {
  let best: Chest | null = null, bestD = CHEST_INTERACT_RANGE;
  for (const c of w.chests) {
    const dd = Math.hypot(c.x - p.x, c.z - p.z);
    if (!c.opened && dd < bestD) { bestD = dd; best = c; }
  }
  return best;
}

/**
 * Walk-over pickup. Returns items picked up this tick, and whether something was left
 * behind because the bag is full.
 */
export function updatePickups(w: CombatWorld, p: PlayerState, inv: Inventory, dt: number): { picked: Item[]; full: boolean } {
  const picked: Item[] = [];
  let full = false;
  for (const l of [...w.loot]) {
    l.delay = Math.max(0, l.delay - dt);
    if (l.delay > 0 || Math.hypot(l.x - p.x, l.z - p.z) > PICKUP_RADIUS) continue;
    const snapshot = { ...l.item } as Item; // name/count as picked, for the feed
    if (addItem(inv, l.item)) {
      picked.push(snapshot);
      w.loot = w.loot.filter((o) => o !== l);
    } else {
      full = true;
    }
  }
  return { picked, full };
}
