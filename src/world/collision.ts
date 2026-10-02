import { type Dungeon, isFloor } from './dungeon/generator';
import { TILE } from './dungeon/meshBuilder';

/**
 * Pushes a circle (x, z, radius) out of any wall tiles it overlaps.
 * Uses closest-point-on-AABB so the player slides along walls instead of sticking.
 */
export function resolveCircleVsWalls(d: Dungeon, pos: { x: number; z: number }, radius: number): void {
  for (let iter = 0; iter < 2; iter++) {
    const tx0 = Math.floor((pos.x - radius) / TILE);
    const tx1 = Math.floor((pos.x + radius) / TILE);
    const ty0 = Math.floor((pos.z - radius) / TILE);
    const ty1 = Math.floor((pos.z + radius) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (isFloor(d, tx, ty)) continue;
        const minX = tx * TILE, maxX = minX + TILE;
        const minZ = ty * TILE, maxZ = minZ + TILE;
        const cx = Math.max(minX, Math.min(pos.x, maxX));
        const cz = Math.max(minZ, Math.min(pos.z, maxZ));
        const dx = pos.x - cx, dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        if (d2 > 1e-8) {
          const dist = Math.sqrt(d2);
          const push = radius - dist;
          pos.x += (dx / dist) * push;
          pos.z += (dz / dist) * push;
        } else {
          // Center is inside the tile: push out along the shallowest axis.
          const exits = [pos.x - minX, maxX - pos.x, pos.z - minZ, maxZ - pos.z];
          const k = exits.indexOf(Math.min(...exits));
          if (k === 0) pos.x = minX - radius;
          else if (k === 1) pos.x = maxX + radius;
          else if (k === 2) pos.z = minZ - radius;
          else pos.z = maxZ + radius;
        }
      }
    }
  }
}

/** Grid-marched line of sight between two world points (walls block, floor doesn't). */
export function hasLineOfSight(d: Dungeon, x0: number, z0: number, x1: number, z1: number): boolean {
  const dist = Math.hypot(x1 - x0, z1 - z0);
  const steps = Math.ceil(dist / (TILE * 0.25));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (isWallAt(d, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false;
  }
  return true;
}

/** True if the world-space XZ point is inside a wall tile. */
export function isWallAt(d: Dungeon, x: number, z: number): boolean {
  return !isFloor(d, Math.floor(x / TILE), Math.floor(z / TILE));
}
