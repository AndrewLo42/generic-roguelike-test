import { describe, expect, it } from 'vitest';
import { generateDungeon, isFloor, roomCenter } from './generator';

/** Flood-fill floor tiles from a point; returns the set of reachable tile indices. */
function reachable(d: ReturnType<typeof generateDungeon>, sx: number, sy: number): Set<number> {
  const seen = new Set<number>([sy * d.width + sx]);
  const stack = [[sx, sy]];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = ny * d.width + nx;
      if (isFloor(d, nx, ny) && !seen.has(k)) { seen.add(k); stack.push([nx, ny]); }
    }
  }
  return seen;
}

describe('generateDungeon', () => {
  it('is deterministic for a given seed', () => {
    const a = generateDungeon(1234);
    const b = generateDungeon(1234);
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
    expect(a.rooms).toEqual(b.rooms);
  });

  it('produces different layouts for different seeds', () => {
    expect(Array.from(generateDungeon(1).tiles)).not.toEqual(Array.from(generateDungeon(2).tiles));
  });

  it.each([1, 7, 42, 999, 31337, 123456])('seed %i: every room reachable, exit != start', (seed) => {
    const d = generateDungeon(seed);
    expect(d.rooms.length).toBeGreaterThanOrEqual(4);
    expect(d.exitRoom).not.toBe(d.startRoom);
    const [sx, sy] = roomCenter(d.rooms[d.startRoom]);
    const seen = reachable(d, sx, sy);
    for (const r of d.rooms) {
      const [cx, cy] = roomCenter(r);
      expect(seen.has(cy * d.width + cx)).toBe(true);
    }
  });

  it('keeps a solid border', () => {
    const d = generateDungeon(55);
    for (let i = 0; i < d.width; i++) {
      expect(isFloor(d, i, 0)).toBe(false);
      expect(isFloor(d, i, d.height - 1)).toBe(false);
      expect(isFloor(d, 0, i)).toBe(false);
      expect(isFloor(d, d.width - 1, i)).toBe(false);
    }
  });
});
