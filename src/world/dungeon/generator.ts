import { Rng } from '../../core/rng';

export const WALL = 0;
export const FLOOR = 1;

export interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Dungeon {
  seed: number;
  width: number;
  height: number;
  /** Row-major tile grid: tiles[y * width + x] is WALL or FLOOR. */
  tiles: Uint8Array;
  rooms: Room[];
  /** Room adjacency after corridor carving (MST + a few loops). */
  edges: [number, number][];
  startRoom: number;
  exitRoom: number;
}

export interface DungeonOptions {
  width: number;
  height: number;
  roomAttempts: number;
  minRoom: number;
  maxRoom: number;
  corridorWidth: number;
  /** Chance to add each non-MST edge as an extra loop. */
  loopChance: number;
}

export const DEFAULT_OPTIONS: DungeonOptions = {
  width: 64,
  height: 64,
  roomAttempts: 60,
  minRoom: 6,
  maxRoom: 12,
  corridorWidth: 2,
  loopChance: 0.12,
};

export const roomCenter = (r: Room): [number, number] => [
  Math.floor(r.x + r.w / 2),
  Math.floor(r.y + r.h / 2),
];

export function generateDungeon(seed: number, opts: Partial<DungeonOptions> = {}): Dungeon {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const rng = new Rng(seed);
  const tiles = new Uint8Array(o.width * o.height);
  const rooms: Room[] = [];

  // 1. Random room placement, rejecting overlaps (with a 2-tile margin so walls exist between rooms).
  for (let i = 0; i < o.roomAttempts; i++) {
    const w = rng.int(o.minRoom, o.maxRoom);
    const h = rng.int(o.minRoom, o.maxRoom);
    const room = { x: rng.int(1, o.width - w - 2), y: rng.int(1, o.height - h - 2), w, h };
    const overlaps = rooms.some(
      (r) =>
        room.x - 2 < r.x + r.w && room.x + room.w + 2 > r.x &&
        room.y - 2 < r.y + r.h && room.y + room.h + 2 > r.y,
    );
    if (!overlaps) rooms.push(room);
  }

  for (const r of rooms) fillRect(tiles, o.width, r.x, r.y, r.w, r.h);

  // 2. Connect rooms: Prim's MST over room-center distances, then sprinkle extra edges for loops.
  const n = rooms.length;
  const dist = (a: number, b: number) => {
    const [ax, ay] = roomCenter(rooms[a]);
    const [bx, by] = roomCenter(rooms[b]);
    return Math.hypot(ax - bx, ay - by);
  };
  const edges: [number, number][] = [];
  const inTree = new Array<boolean>(n).fill(false);
  if (n > 0) inTree[0] = true;
  for (let added = 1; added < n; added++) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let a = 0; a < n; a++) {
      if (!inTree[a]) continue;
      for (let b = 0; b < n; b++) {
        if (inTree[b]) continue;
        const d = dist(a, b);
        if (d < bestD) { bestD = d; best = [a, b]; }
      }
    }
    if (!best) break;
    inTree[best[1]] = true;
    edges.push(best);
  }
  const hasEdge = (a: number, b: number) => edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      if (!hasEdge(a, b) && dist(a, b) < 28 && rng.chance(o.loopChance)) edges.push([a, b]);
    }
  }

  // 3. Carve L-shaped corridors.
  for (const [a, b] of edges) {
    const [ax, ay] = roomCenter(rooms[a]);
    const [bx, by] = roomCenter(rooms[b]);
    const cw = o.corridorWidth;
    if (rng.chance(0.5)) {
      fillRect(tiles, o.width, Math.min(ax, bx), ay, Math.abs(ax - bx) + cw, cw);
      fillRect(tiles, o.width, bx, Math.min(ay, by), cw, Math.abs(ay - by) + cw);
    } else {
      fillRect(tiles, o.width, ax, Math.min(ay, by), cw, Math.abs(ay - by) + cw);
      fillRect(tiles, o.width, Math.min(ax, bx), by, Math.abs(ax - bx) + cw, cw);
    }
  }

  // 4. Start = room 0; exit = room farthest away by graph hops (ties broken by distance).
  const startRoom = 0;
  const hops = bfsHops(n, edges, startRoom);
  let exitRoom = startRoom;
  for (let i = 0; i < n; i++) {
    if (hops[i] > hops[exitRoom] || (hops[i] === hops[exitRoom] && dist(startRoom, i) > dist(startRoom, exitRoom))) {
      exitRoom = i;
    }
  }

  return { seed, width: o.width, height: o.height, tiles, rooms, edges, startRoom, exitRoom };
}

export function isFloor(d: Dungeon, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= d.width || y >= d.height) return false;
  return d.tiles[y * d.width + x] === FLOOR;
}

function fillRect(tiles: Uint8Array, width: number, x: number, y: number, w: number, h: number) {
  const height = tiles.length / width;
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) {
      // Keep a 1-tile solid border around the map.
      if (i > 0 && j > 0 && i < width - 1 && j < height - 1) tiles[j * width + i] = FLOOR;
    }
  }
}

function bfsHops(n: number, edges: [number, number][], start: number): number[] {
  const hops = new Array<number>(n).fill(-1);
  if (n === 0) return hops;
  hops[start] = 0;
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const [a, b] of edges) {
      const next = a === cur ? b : b === cur ? a : -1;
      if (next >= 0 && hops[next] < 0) {
        hops[next] = hops[cur] + 1;
        queue.push(next);
      }
    }
  }
  return hops;
}
