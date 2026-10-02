import * as THREE from 'three';
import type { Chest, CombatWorld, GroundLoot } from '../combat/world';
import { ITEM_RARITY_COLOR } from '../data/items';
import { getPiece } from './assets';

const LABEL_RANGE = 12;

interface LootVisual {
  group: THREE.Group;
  gem: THREE.Mesh;
  label: HTMLDivElement;
  disposables: (THREE.BufferGeometry | THREE.Material)[];
}

interface ChestVisual {
  group: THREE.Group;
  lid: THREE.Object3D;
  /** Lid rotation.x when closed (KayKit lids have their own rest pose). */
  lidRest: number;
  opened: boolean;
}

const CHEST_SCALE = 0.85;

/** Ground items (spinning gems + rarity beams + name labels) and chests. */
export class LootView {
  private loot = new Map<number, LootVisual>();
  private chests = new Map<number, ChestVisual>();
  private tmp = new THREE.Vector3();
  private time = 0;
  // Shared chest geometry/materials (chests are never disposed individually).
  private chestBodyGeo = new THREE.BoxGeometry(1.3, 0.75, 0.85);
  private chestLidGeo = new THREE.BoxGeometry(1.36, 0.25, 0.9);
  private chestBandGeo = new THREE.BoxGeometry(0.16, 0.8, 0.9);
  private woodMat = new THREE.MeshStandardMaterial({ color: 0x7a4a24, roughness: 0.8 });
  private metalMat = new THREE.MeshStandardMaterial({ color: 0xd9b45a, roughness: 0.4, metalness: 0.6 });

  constructor(private scene: THREE.Scene, private camera: THREE.PerspectiveCamera, private overlay: HTMLElement) {}

  sync(w: CombatWorld, px: number, pz: number, dt: number) {
    this.time += dt;
    const live = new Set<number>();
    for (const l of w.loot) {
      live.add(l.id);
      const v = this.loot.get(l.id) ?? this.createLoot(l);
      v.group.position.set(l.x, 0, l.z);
      v.gem.rotation.y = this.time * 2 + l.id;
      v.gem.position.y = 0.55 + Math.sin(this.time * 3 + l.id) * 0.1;

      const near = Math.hypot(l.x - px, l.z - pz) < LABEL_RANGE;
      const onScreen = near && this.project(this.tmp.set(l.x, 1.15, l.z));
      v.label.style.display = onScreen ? 'block' : 'none';
      if (onScreen) v.label.style.transform = `translate(${this.tmp.x}px, ${this.tmp.y}px) translate(-50%, -100%)`;
    }
    for (const id of [...this.loot.keys()]) if (!live.has(id)) this.removeLoot(id);

    const liveChests = new Set<number>();
    for (const c of w.chests) {
      liveChests.add(c.id);
      const v = this.chests.get(c.id) ?? this.createChest(c);
      // Lid swings open over ~0.3s.
      const target = v.lidRest + (c.opened ? -1.9 : 0);
      v.lid.rotation.x += (target - v.lid.rotation.x) * Math.min(1, dt * 10);
    }
    for (const [id, v] of this.chests) {
      if (!liveChests.has(id)) { this.scene.remove(v.group); this.chests.delete(id); }
    }
  }

  clear() {
    for (const id of [...this.loot.keys()]) this.removeLoot(id);
    for (const v of this.chests.values()) this.scene.remove(v.group);
    this.chests.clear();
  }

  private project(out: THREE.Vector3): boolean {
    out.project(this.camera);
    if (out.z > 1 || Math.abs(out.x) > 1.1 || Math.abs(out.y) > 1.1) return false;
    out.x = (out.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-out.y * 0.5 + 0.5) * window.innerHeight;
    return true;
  }

  private createLoot(l: GroundLoot): LootVisual {
    const color = new THREE.Color(ITEM_RARITY_COLOR[l.item.rarity]);
    const group = new THREE.Group();
    const isPotion = l.item.kind === 'potion';
    const gemGeo = isPotion ? new THREE.SphereGeometry(0.22, 12, 8) : new THREE.OctahedronGeometry(0.3);
    const gemMat = new THREE.MeshStandardMaterial({
      color: isPotion ? 0xe0413a : color, emissive: isPotion ? 0x801a14 : color, emissiveIntensity: 0.6, roughness: 0.3,
    });
    const gem = new THREE.Mesh(gemGeo, gemMat);
    gem.castShadow = true;
    group.add(gem);
    const disposables: (THREE.BufferGeometry | THREE.Material)[] = [gemGeo, gemMat];

    // Light beam for rare and epic so good drops are visible across a room.
    if (l.item.rarity === 'rare' || l.item.rarity === 'epic') {
      const beamGeo = new THREE.CylinderGeometry(0.08, 0.2, 6, 8, 1, true).translate(0, 3, 0);
      const beamMat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      group.add(new THREE.Mesh(beamGeo, beamMat));
      disposables.push(beamGeo, beamMat);
    }
    this.scene.add(group);

    const label = document.createElement('div');
    label.className = 'loot-label';
    label.style.color = isPotion ? '#ff8a80' : ITEM_RARITY_COLOR[l.item.rarity];
    label.textContent = l.item.kind === 'potion' && l.item.count > 1 ? `${l.item.name} ×${l.item.count}` : l.item.name;
    this.overlay.appendChild(label);

    const v = { group, gem, label, disposables };
    this.loot.set(l.id, v);
    return v;
  }

  private removeLoot(id: number) {
    const v = this.loot.get(id)!;
    this.scene.remove(v.group);
    v.disposables.forEach((d) => d.dispose());
    v.label.remove();
    this.loot.delete(id);
  }

  private createChest(c: Chest): ChestVisual {
    const piece = getPiece(c.gold ? 'chest_gold' : 'chest');
    if (piece) {
      // KayKit chest: the lid is its own node pivoted at the hinge.
      const group = new THREE.Group();
      const model = piece.clone();
      model.scale.setScalar(CHEST_SCALE);
      model.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true; });
      const lid = model.getObjectByName(c.gold ? 'chest_gold_lid' : 'chest_lid') ?? new THREE.Object3D();
      group.add(model);
      group.position.set(c.x, 0, c.z);
      group.rotation.y = c.facing;
      this.scene.add(group);
      const v = { group, lid, lidRest: lid.rotation.x, opened: c.opened };
      this.chests.set(c.id, v);
      return v;
    }
    return this.createPlaceholderChest(c);
  }

  private createPlaceholderChest(c: Chest): ChestVisual {
    const group = new THREE.Group();
    const body = new THREE.Mesh(this.chestBodyGeo, this.woodMat);
    body.position.y = 0.375;
    body.castShadow = body.receiveShadow = true;
    const bandL = new THREE.Mesh(this.chestBandGeo, this.metalMat);
    bandL.position.set(-0.4, 0.4, 0);
    const bandR = bandL.clone();
    bandR.position.x = 0.4;
    // Lid pivots on its back edge (local -Z is the back; the chest faces +Z).
    const lid = new THREE.Group();
    lid.position.set(0, 0.75, -0.45);
    const lidMesh = new THREE.Mesh(this.chestLidGeo, this.woodMat);
    lidMesh.position.set(0, 0.125, 0.45);
    lidMesh.castShadow = true;
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.25, 0.08), this.metalMat);
    lock.position.set(0, 0, 0.92);
    lid.add(lidMesh, lock);
    group.add(body, bandL, bandR, lid);
    group.position.set(c.x, 0, c.z);
    group.rotation.y = c.facing;
    this.scene.add(group);
    const v = { group, lid, lidRest: 0, opened: c.opened };
    this.chests.set(c.id, v);
    return v;
  }
}
