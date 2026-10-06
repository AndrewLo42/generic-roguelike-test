import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { ModelVisual } from '../data/classes';

/**
 * KayKit asset registry. Everything is loaded once up front; if a file fails to load the game
 * falls back to the primitive placeholders (every getter returns undefined).
 */

const BASE = `${import.meta.env.BASE_URL}assets/kaykit/`;

export const CHARACTER_MODELS = ['Knight', 'Rogue_Hooded', 'Rogue', 'Mage', 'Skeleton_Minion', 'Skeleton_Warrior', 'Skeleton_Mage'];
export const DUNGEON_PIECES = [
  'floor_tile_small', 'floor_tile_small_broken_A', 'floor_tile_small_decorated',
  'wall', 'torch_mounted', 'chest', 'chest_gold', 'pillar', 'barrel_small', 'crates_stacked',
];

const characters = new Map<string, GLTF>();
const pieces = new Map<string, THREE.Group>();

export async function loadAssets(onProgress?: (done: number, total: number) => void): Promise<boolean> {
  const loader = new GLTFLoader();
  const jobs: [string, string, 'char' | 'piece'][] = [
    ...CHARACTER_MODELS.map((n) => [n, `${BASE}characters/${n}.glb`, 'char'] as [string, string, 'char']),
    ...DUNGEON_PIECES.map((n) => [n, `${BASE}dungeon/${n}.glb`, 'piece'] as [string, string, 'piece']),
  ];
  let done = 0;
  let ok = true;
  await Promise.all(jobs.map(async ([name, url, kind]) => {
    try {
      const gltf = await loader.loadAsync(url);
      if (kind === 'char') characters.set(name, gltf);
      else pieces.set(name, gltf.scene);
    } catch (err) {
      ok = false;
      console.warn(`[assets] failed to load ${url}`, err);
    }
    onProgress?.(++done, jobs.length);
  }));
  return ok;
}

export const hasCharacter = (name: string) => characters.has(name);

/** Props parented to hand slots are optional loadout pieces: show only the ones named in `keep`. */
export function showHandProps(root: THREE.Object3D, keep: string[]) {
  root.traverse((o) => {
    if (o.parent?.name.startsWith('handslot')) o.visible = keep.includes(o.name);
  });
}
export const getPiece = (name: string) => pieces.get(name);

/** All meshes of a static piece, with their transforms baked relative to the piece root. */
export function pieceParts(name: string): { geometry: THREE.BufferGeometry; material: THREE.Material; name: string }[] {
  const root = pieces.get(name);
  if (!root) return [];
  root.updateMatrixWorld(true);
  const parts: { geometry: THREE.BufferGeometry; material: THREE.Material; name: string }[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const geometry = m.geometry.clone().applyMatrix4(m.matrixWorld);
    parts.push({ geometry, material: m.material as THREE.Material, name: m.name });
  });
  return parts;
}

/**
 * A fresh, independently animatable instance of a character, set up per `visual`:
 * unused hand-slot props hidden, optional weapon borrowed from another model, scaled,
 * shadows on, and materials cloned so per-instance hit flashes don't leak.
 */
export function instantiateCharacter(visual: ModelVisual): { root: THREE.Object3D; clips: THREE.AnimationClip[]; materials: THREE.MeshStandardMaterial[] } | null {
  const gltf = characters.get(visual.model);
  if (!gltf) return null;
  const root = cloneSkinned(gltf.scene);
  root.scale.setScalar(visual.scale);

  const materials: THREE.MeshStandardMaterial[] = [];
  const matCache = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.frustumCulled = false; // skinned bounds don't follow animation
    const src = m.material as THREE.MeshStandardMaterial;
    let mat = matCache.get(src);
    if (!mat) { mat = src.clone(); matCache.set(src, mat); materials.push(mat); }
    m.material = mat;
  });
  showHandProps(root, visual.keep);

  if (visual.weapon) {
    const src = characters.get(visual.weapon.from)?.scene.getObjectByName(visual.weapon.mesh) as THREE.Mesh | undefined;
    // GLTFLoader sanitizes node names ("handslot.r" -> "handslotr").
    const slot = root.getObjectByName('handslotr') ?? root.getObjectByName('handslot.r');
    if (src && slot) {
      const w = src.clone();
      w.material = (src.material as THREE.Material).clone();
      materials.push(w.material as THREE.MeshStandardMaterial);
      w.castShadow = true;
      w.visible = true;
      slot.add(w);
    }
  }
  return { root, clips: gltf.animations, materials };
}
