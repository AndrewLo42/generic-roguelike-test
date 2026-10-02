import * as THREE from 'three';
import { type Dungeon, isFloor, roomCenter } from './generator';
import { getPiece, pieceParts } from '../../render/assets';

export const TILE = 2; // world units per tile
export const WALL_HEIGHT = 4; // matches the KayKit wall piece

/** Tile (x, y) -> world XZ at tile center. */
export const tileToWorld = (x: number, y: number) => new THREE.Vector3((x + 0.5) * TILE, 0, (y + 0.5) * TILE);

export interface DungeonVisual {
  group: THREE.Group;
  exit: THREE.Object3D;
  /** World positions of wall torches (flame point), for the dynamic light pool. */
  torches: THREE.Vector3[];
}

/** Stable per-tile hash for deterministic decoration choices. */
const hash = (x: number, y: number, salt = 0) => (((x * 73856093) ^ (y * 19349663) ^ (salt * 83492791)) >>> 0) % 1000;

/** Tiles that are walls but touch a floor (including diagonally). */
function edgeWallTiles(d: Dungeon): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 0; y < d.height; y++) {
    for (let x = 0; x < d.width; x++) {
      if (isFloor(d, x, y)) continue;
      let touches = false;
      for (let dy = -1; dy <= 1 && !touches; dy++)
        for (let dx = -1; dx <= 1 && !touches; dx++) touches = isFloor(d, x + dx, y + dy);
      if (touches) out.push([x, y]);
    }
  }
  return out;
}

export function buildDungeonMesh(d: Dungeon): DungeonVisual {
  const group = new THREE.Group();
  const torches = getPiece('wall') && getPiece('floor_tile_small')
    ? buildKayKit(d, group)
    : (buildBoxes(d, group), []);

  // Exit portal in the exit room.
  const [ex, ey] = roomCenter(d.rooms[d.exitRoom]);
  const exit = new THREE.Mesh(
    new THREE.TorusGeometry(1.2, 0.18, 12, 32),
    new THREE.MeshStandardMaterial({ color: 0x66ccff, emissive: 0x3399ff, emissiveIntensity: 2 }),
  );
  exit.position.copy(tileToWorld(ex, ey)).setY(1.5);
  const glow = new THREE.PointLight(0x55aaff, 8, 10);
  exit.add(glow);
  group.add(exit);

  return { group, exit, torches };
}

// ---------- KayKit ----------

/** Instanced copies of a (possibly multi-mesh) piece; one InstancedMesh per part, sharing matrices. */
function instanced(name: string, matrices: THREE.Matrix4[], opts: { cast?: boolean; receive?: boolean } = {}): THREE.Object3D[] {
  if (!matrices.length) return [];
  return pieceParts(name).map(({ geometry, material }) => {
    material.userData.shared = true; // owned by the asset cache — don't dispose with the floor
    const im = new THREE.InstancedMesh(geometry, material, matrices.length);
    matrices.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = !!opts.cast;
    im.receiveShadow = opts.receive ?? true;
    im.computeBoundingSphere();
    return im;
  });
}

type Dir = 'N' | 'S' | 'E' | 'W';
const DIRS: { dir: Dir; dx: number; dy: number }[] = [
  { dir: 'N', dx: 0, dy: -1 }, { dir: 'S', dx: 0, dy: 1 }, { dir: 'W', dx: -1, dy: 0 }, { dir: 'E', dx: 1, dy: 0 },
];

function buildKayKit(d: Dungeon, group: THREE.Group): THREE.Vector3[] {
  const m = () => new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const compose = (x: number, y: number, z: number, rotY: number, sx = 1, sy = 1, sz = 1) =>
    m().compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, rotY).clone(), new THREE.Vector3(sx, sy, sz));

  // Floors: mostly plain tiles with a sprinkle of variants, randomly rotated to hide repetition.
  const floorSets: Record<string, THREE.Matrix4[]> = {
    floor_tile_small: [], floor_tile_small_broken_A: [], floor_tile_small_decorated: [],
  };
  for (let y = 0; y < d.height; y++) {
    for (let x = 0; x < d.width; x++) {
      if (!isFloor(d, x, y)) continue;
      const h = hash(x, y);
      const piece = h < 60 ? 'floor_tile_small_broken_A' : h < 85 ? 'floor_tile_small_decorated' : 'floor_tile_small';
      const p = tileToWorld(x, y);
      floorSets[piece].push(compose(p.x, 0, p.z, (hash(x, y, 1) % 4) * (Math.PI / 2)));
    }
  }
  for (const [name, mats] of Object.entries(floorSets)) group.add(...instanced(name, mats));

  // Wall faces: every floor tile edge that borders a wall, grouped into straight runs so most
  // segments use the full 4-wide wall piece (2 tiles); odd leftovers use a half-scaled one.
  // Pieces sit 0.5 into the wall tile so their inner face lines up with the collision boundary.
  const runs = new Map<string, number[]>(); // key: dir|line -> positions along the line
  for (let y = 0; y < d.height; y++) {
    for (let x = 0; x < d.width; x++) {
      if (!isFloor(d, x, y)) continue;
      for (const { dir, dx, dy } of DIRS) {
        if (isFloor(d, x + dx, y + dy)) continue;
        const horizontal = dir === 'N' || dir === 'S';
        const key = `${dir}|${horizontal ? y : x}`;
        (runs.get(key) ?? runs.set(key, []).get(key)!).push(horizontal ? x : y);
      }
    }
  }
  const walls: THREE.Matrix4[] = [];
  const torchMats: THREE.Matrix4[] = [];
  const torches: THREE.Vector3[] = [];
  for (const [key, positions] of runs) {
    const [dir, lineStr] = key.split('|') as [Dir, string];
    const line = Number(lineStr);
    positions.sort((a, b) => a - b);
    const horizontal = dir === 'N' || dir === 'S';
    // Boundary coordinate and the offset into the wall tile.
    const boundary = (dir === 'N' || dir === 'W' ? line : line + 1) * TILE;
    const into = dir === 'N' || dir === 'W' ? -0.5 : 0.5;
    const rot = horizontal ? 0 : Math.PI / 2;
    const place = (along: number, sx: number) =>
      horizontal
        ? walls.push(compose(along, 0, boundary + into, rot, sx))
        : walls.push(compose(boundary + into, 0, along, rot, sx));

    let i = 0;
    while (i < positions.length) {
      let j = i;
      while (j + 1 < positions.length && positions[j + 1] === positions[j] + 1) j++;
      // Run from positions[i] .. positions[j] (inclusive)
      let t = positions[i];
      for (; t + 1 <= positions[j]; t += 2) place((t + 1) * TILE, 1);
      if (t === positions[j]) place((t + 0.5) * TILE, 0.5);
      i = j + 1;
    }

    // Torches: sparse, deterministic, facing into the room (torch model's +Z points away from the wall).
    for (const pos of positions) {
      if (hash(pos, line, dir.charCodeAt(0)) >= 300 || pos % 3 !== 0) continue;
      const facing = { N: 0, S: Math.PI, W: Math.PI / 2, E: -Math.PI / 2 }[dir];
      const along = (pos + 0.5) * TILE;
      const [x, z] = horizontal ? [along, boundary] : [boundary, along];
      torchMats.push(compose(x, 2.2, z, facing));
      torches.push(new THREE.Vector3(x + Math.sin(facing) * 0.5, 2.9, z + Math.cos(facing) * 0.5));
    }
  }
  group.add(...instanced('wall', walls, { cast: true }));
  group.add(...instanced('torch_mounted', torchMats));

  // Pillars at concave corners (where two walls meet around a floor tile) hide the seam.
  const pillars: THREE.Matrix4[] = [];
  for (let y = 0; y < d.height; y++) {
    for (let x = 0; x < d.width; x++) {
      if (!isFloor(d, x, y)) continue;
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        if (!isFloor(d, x + dx, y) && !isFloor(d, x, y + dy)) {
          pillars.push(compose((x + (dx > 0 ? 1 : 0)) * TILE, 0, (y + (dy > 0 ? 1 : 0)) * TILE, 0, 0.7, 1, 0.7));
        }
      }
    }
  }
  group.add(...instanced('pillar', pillars, { cast: true }));

  // Dark caps fill the wall tiles behind the wall faces so the camera never sees into the void.
  const caps = edgeWallTiles(d);
  const capGeo = new THREE.BoxGeometry(TILE - 0.04, WALL_HEIGHT - 0.04, TILE - 0.04).translate(0, (WALL_HEIGHT - 0.04) / 2, 0);
  const capMesh = new THREE.InstancedMesh(capGeo, new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 1 }), caps.length);
  caps.forEach(([x, y], i) => { const p = tileToWorld(x, y); capMesh.setMatrixAt(i, compose(p.x, 0, p.z, 0)); });
  group.add(capMesh);

  return torches;
}

// ---------- Placeholder (no assets) ----------

function buildBoxes(d: Dungeon, group: THREE.Group) {
  const floorCount = d.tiles.reduce((n, t) => n + t, 0);
  const wallTiles = edgeWallTiles(d);

  const floors = new THREE.InstancedMesh(
    new THREE.BoxGeometry(TILE, 0.2, TILE), new THREE.MeshStandardMaterial({ color: 0x4a4a52, roughness: 0.95 }), floorCount);
  floors.receiveShadow = true;
  const walls = new THREE.InstancedMesh(
    new THREE.BoxGeometry(TILE, WALL_HEIGHT, TILE), new THREE.MeshStandardMaterial({ color: 0x6b5d4f, roughness: 0.85 }), wallTiles.length);
  walls.castShadow = walls.receiveShadow = true;

  const m = new THREE.Matrix4();
  const color = new THREE.Color();
  let i = 0;
  for (let y = 0; y < d.height; y++) {
    for (let x = 0; x < d.width; x++) {
      if (!isFloor(d, x, y)) continue;
      const p = tileToWorld(x, y);
      floors.setMatrixAt(i, m.makeTranslation(p.x, -0.1, p.z));
      floors.setColorAt(i++, color.setScalar((x + y) % 2 ? 1 : 0.9));
    }
  }
  wallTiles.forEach(([x, y], j) => {
    const p = tileToWorld(x, y);
    walls.setMatrixAt(j, m.makeTranslation(p.x, WALL_HEIGHT / 2, p.z));
  });
  group.add(floors, walls);
}

/** Dispose per-floor GPU resources (asset-cache materials are skipped). */
export function disposeGroup(group: THREE.Object3D) {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const mat = mesh.material;
    const dispose = (x: THREE.Material) => { if (!x.userData.shared) x.dispose(); };
    if (Array.isArray(mat)) mat.forEach(dispose);
    else if (mat) dispose(mat);
    if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
  });
}
