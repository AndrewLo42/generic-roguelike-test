import * as THREE from 'three';
import type { CombatEvent, CombatWorld, Enemy, EnemyState, Telegraph } from '../combat/world';
import { instantiateCharacter } from './assets';
import { AnimatedModel, impactTimeScale } from './animatedModel';
import { ELEMENT_COLOR } from '../data/combos';
import { STATUS, type StatusId, has } from '../combat/status';
import type { ComboField } from '../combat/world';

interface EnemyVisual {
  group: THREE.Group;
  /** Invisible capsule used for click-to-target raycasts (skinned meshes are costly to raycast). */
  hitbox: THREE.Mesh;
  /** Materials tinted for hit flash / wind-up glow. */
  mats: THREE.MeshStandardMaterial[];
  /** Placeholder-only: tilted back during wind-up. */
  body: THREE.Object3D | null;
  model: AnimatedModel | null;
  lastState: EnemyState | null;
  /** Things this visual owns and must dispose (model geometry is shared with the GLTF — not included). */
  disposables: (THREE.BufferGeometry | THREE.Material)[];
  plate: HTMLDivElement;
  plateFill: HTMLDivElement;
  plateStatus: HTMLDivElement;
}

interface FieldVisual {
  group: THREE.Group;
  disc: THREE.Mesh;
  ring: THREE.Mesh;
  mats: THREE.MeshBasicMaterial[];
}

interface Corpse {
  v: EnemyVisual;
  age: number;
}

const CULL_DIST = 48;
const CORPSE_LINGER = 1.6;
const CORPSE_SINK = 0.8;

interface TelegraphVisual {
  group: THREE.Group;
  fill: THREE.Mesh;
  disposables: (THREE.BufferGeometry | THREE.Material)[];
}

interface FloatingText {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  age: number;
}

const HOSTILE_COLOR = 0xff3b30;
const FRIENDLY_COLOR = 0xffa040;
const TEXT_LIFE = 0.9;

/**
 * Mirrors CombatWorld into the scene: enemy meshes, telegraph decals, projectiles, target ring,
 * plus HTML nameplates and floating combat text projected from world space.
 */
export class CombatView {
  private enemies = new Map<number, EnemyVisual>();
  private corpses: Corpse[] = [];
  private telegraphs = new Map<number, TelegraphVisual>();
  private projectiles = new Map<number, THREE.Mesh>();
  private fields = new Map<number, FieldVisual>();
  private fieldDiscGeo = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
  private fieldRingGeo = new THREE.RingGeometry(0.93, 1, 48).rotateX(-Math.PI / 2);
  private projMats = new Map<number, THREE.MeshBasicMaterial>();
  private time = 0;
  private texts: FloatingText[] = [];
  private targetRing: THREE.Mesh;
  private projGeo = new THREE.SphereGeometry(0.3, 12, 8);

  private tmp = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private camera: THREE.PerspectiveCamera, private overlay: HTMLElement) {
    this.targetRing = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.targetRing.visible = false;
    scene.add(this.targetRing);
  }

  /** Enemy meshes, for click-to-target raycasts. Each mesh carries userData.enemyId. */
  get pickables(): THREE.Object3D[] {
    return [...this.enemies.values()].map((v) => v.hitbox);
  }

  sync(w: CombatWorld, alpha: number, hardTargeted: boolean, dt: number) {
    this.syncEnemies(w, alpha, dt);
    this.updateCorpses(dt);
    this.time += dt;
    this.syncTelegraphs(w);
    this.syncFields(w);
    this.syncProjectiles(w, alpha);

    const target = w.enemies.find((e) => e.id === w.targetId);
    this.targetRing.visible = !!target;
    if (target) {
      const v = this.enemies.get(target.id)!;
      this.targetRing.position.set(v.group.position.x, 0.04, v.group.position.z);
      this.targetRing.scale.setScalar(target.def.radius * 1.6 + 0.4);
      (this.targetRing.material as THREE.MeshBasicMaterial).color.setHex(hardTargeted ? 0xffe066 : 0xffffff);
      (this.targetRing.material as THREE.MeshBasicMaterial).opacity = hardTargeted ? 0.95 : 0.45;
    }

    for (const ev of w.events) this.spawnText(ev);
    w.events.length = 0;
  }

  /** Per-frame HTML positioning; call after the camera has moved. */
  updateOverlay(w: CombatWorld, dt: number) {
    for (const e of w.enemies) {
      const v = this.enemies.get(e.id);
      if (!v) continue;
      const show = e.state !== 'idle' || e.hp < e.maxHp || e.id === w.targetId;
      const onScreen = show && this.project(this.tmp.set(v.group.position.x, e.def.height + 0.55, v.group.position.z));
      v.plate.style.display = onScreen ? 'block' : 'none';
      if (onScreen) {
        v.plate.style.transform = `translate(${this.tmp.x}px, ${this.tmp.y}px) translate(-50%, -100%)`;
        v.plateFill.style.width = `${(Math.max(0, e.hp) / e.maxHp) * 100}%`;
        const icons = (Object.keys(e.status) as StatusId[])
          .map((id) => `${STATUS[id].icon}${(e.status[id]!.stacks > 1) ? `<sub>${e.status[id]!.stacks}</sub>` : ''}`).join('');
        if (v.plateStatus.innerHTML !== icons) v.plateStatus.innerHTML = icons;
        v.plate.classList.toggle('targeted', e.id === w.targetId);
      }
    }

    for (const t of [...this.texts]) {
      t.age += dt;
      if (t.age >= TEXT_LIFE) {
        t.el.remove();
        this.texts.splice(this.texts.indexOf(t), 1);
        continue;
      }
      const k = t.age / TEXT_LIFE;
      const visible = this.project(this.tmp.copy(t.pos).setY(t.pos.y + k * 1.2));
      t.el.style.display = visible ? 'block' : 'none';
      t.el.style.transform = `translate(${this.tmp.x}px, ${this.tmp.y}px) translate(-50%, -50%) scale(${1 + (1 - k) * 0.3})`;
      t.el.style.opacity = String(1 - k * k);
    }
  }

  clear() {
    for (const id of [...this.enemies.keys()]) this.removeEnemy(id, false);
    for (const c of this.corpses) this.disposeEnemy(c.v);
    this.corpses = [];
    for (const id of [...this.telegraphs.keys()]) this.removeTelegraph(id);
    for (const id of [...this.fields.keys()]) this.removeField(id);
    for (const [id, m] of this.projectiles) { this.scene.remove(m); this.projectiles.delete(id); }
    for (const t of this.texts) t.el.remove();
    this.texts = [];
    this.targetRing.visible = false;
  }

  // ---------- internals ----------

  /** World -> screen pixels in `out`. Returns false if behind the camera or off-screen. */
  private project(out: THREE.Vector3): boolean {
    out.project(this.camera);
    if (out.z > 1 || Math.abs(out.x) > 1.1 || Math.abs(out.y) > 1.1) return false;
    out.x = (out.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-out.y * 0.5 + 0.5) * window.innerHeight;
    return true;
  }

  private syncEnemies(w: CombatWorld, alpha: number, dt: number) {
    const alive = new Set<number>();
    for (const e of w.enemies) {
      alive.add(e.id);
      const v = this.enemies.get(e.id) ?? this.createEnemy(e);
      v.group.position.set(e.prevX + (e.x - e.prevX) * alpha, 0, e.prevZ + (e.z - e.prevZ) * alpha);
      v.group.rotation.y = e.facing;
      // Skinned meshes can't be frustum-culled reliably; skip far ones (beyond the fog) instead.
      v.group.visible = v.group.position.distanceToSquared(this.camera.position) < CULL_DIST * CULL_DIST;
      if (!v.group.visible) continue;
      const winding = e.state === 'windup';
      // Hit flash (white) > wind-up glow (red) so attacks read even without looking at the floor.
      for (const m of v.mats) {
        // Priority: hit flash > wind-up > burning flicker > chill > vulnerability.
        const burnFlicker = 0.5 + 0.5 * Math.sin(this.time * 18 + e.id);
        m.emissive.setHex(
          e.hitFlash > 0 ? 0xffffff : winding ? 0x661100
            : has(e.status, 'burning') ? (burnFlicker > 0.5 ? 0x7a2a00 : 0x4a1800)
            : has(e.status, 'chill') ? 0x0d3a55
            : has(e.status, 'vulnerability') ? 0x2a0d40 : 0x000000,
        );
        m.emissiveIntensity = e.hitFlash > 0 ? 0.6 : 1;
      }
      if (v.model) this.animateEnemy(e, v, dt);
      else if (v.body) v.body.rotation.x = winding ? -0.25 : 0;
      v.lastState = e.state;
    }
    for (const id of [...this.enemies.keys()]) if (!alive.has(id)) this.removeEnemy(id, true);
  }

  private animateEnemy(e: Enemy, v: EnemyVisual, dt: number) {
    const m = v.model!;
    const vis = e.def.visual;
    if (e.state === 'windup' && v.lastState !== 'windup') {
      // Time the swing so it connects exactly when the telegraph resolves.
      m.playOnce(vis.attack, { timeScale: impactTimeScale(m.clip(vis.attack), vis.attackImpact, e.def.attack.windup) });
    }
    const moving = Math.hypot(e.x - e.prevX, e.z - e.prevZ) > 0.01;
    if (moving) m.setBase(vis.move, Math.max(0.6, e.def.speed / 4.5));
    else m.setBase(e.state === 'idle' ? 'Idle' : vis.idle);
    m.update(dt);
  }

  private createEnemy(e: Enemy): EnemyVisual {
    const group = new THREE.Group();
    const { radius: r, height: h, color } = e.def;
    const disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

    const hitGeo = new THREE.CapsuleGeometry(r * 1.1, Math.max(0.1, h - r * 2), 4, 8).translate(0, h / 2, 0);
    const hitMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitbox = new THREE.Mesh(hitGeo, hitMat);
    hitbox.userData.enemyId = e.id;
    group.add(hitbox);
    disposables.push(hitGeo, hitMat);

    let model: AnimatedModel | null = null;
    let body: THREE.Object3D | null = null;
    let mats: THREE.MeshStandardMaterial[];
    const inst = instantiateCharacter(e.def.visual);
    if (inst) {
      group.add(inst.root);
      model = new AnimatedModel(inst.root, inst.clips);
      model.setBase('Idle');
      mats = inst.materials;
      disposables.push(...inst.materials);
    } else {
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
      const geo = e.def.attack.shape === 'targetCircle'
        ? new THREE.ConeGeometry(r * 1.4, h, 10).translate(0, h / 2, 0)
        : new THREE.CapsuleGeometry(r, h - r * 2, 6, 12).translate(0, h / 2, 0);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      group.add(mesh);
      body = mesh;
      mats = [mat];
      disposables.push(geo, mat);
    }
    this.scene.add(group);

    const plate = document.createElement('div');
    plate.className = 'plate';
    plate.innerHTML = `<span>${e.def.name}</span><div class="plate-bar"><div></div></div><div class="plate-status"></div>`;
    this.overlay.appendChild(plate);
    const v: EnemyVisual = {
      group, hitbox, mats, body, model, lastState: null, disposables,
      plate, plateFill: plate.querySelector<HTMLDivElement>('.plate-bar > div')!,
      plateStatus: plate.querySelector<HTMLDivElement>('.plate-status')!,
    };
    this.enemies.set(e.id, v);
    return v;
  }

  /** @param died  play the death animation and leave a corpse briefly instead of vanishing */
  private removeEnemy(id: number, died: boolean) {
    const v = this.enemies.get(id)!;
    this.enemies.delete(id);
    v.plate.remove();
    if (died && v.model) {
      for (const m of v.mats) m.emissive.setHex(0x000000);
      v.model.playOnce('Death_A', { persistent: true });
      this.corpses.push({ v, age: 0 });
      return;
    }
    this.disposeEnemy(v);
  }

  private updateCorpses(dt: number) {
    for (const c of [...this.corpses]) {
      c.age += dt;
      c.v.model?.update(dt);
      // Linger, then sink through the floor.
      if (c.age > CORPSE_LINGER) c.v.group.position.y = -((c.age - CORPSE_LINGER) / CORPSE_SINK) * 1.5;
      if (c.age > CORPSE_LINGER + CORPSE_SINK) {
        this.disposeEnemy(c.v);
        this.corpses.splice(this.corpses.indexOf(c), 1);
      }
    }
  }

  private disposeEnemy(v: EnemyVisual) {
    this.scene.remove(v.group);
    v.model?.dispose();
    v.disposables.forEach((d) => d.dispose());
  }

  private syncTelegraphs(w: CombatWorld) {
    const live = new Set<number>();
    for (const t of w.telegraphs) {
      live.add(t.id);
      const v = this.telegraphs.get(t.id) ?? this.createTelegraph(t);
      const k = Math.min(1, t.elapsed / Math.max(t.duration, 1e-3));
      v.fill.scale.set(k, 1, k);
    }
    for (const id of [...this.telegraphs.keys()]) if (!live.has(id)) this.removeTelegraph(id);
  }

  private createTelegraph(t: Telegraph): TelegraphVisual {
    const color = t.hostile ? HOSTILE_COLOR : FRIENDLY_COLOR;
    const group = new THREE.Group();
    const s = t.shape;
    const mk = (opacity: number) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });

    let baseGeo: THREE.BufferGeometry, fillGeo: THREE.BufferGeometry, edgeGeo: THREE.BufferGeometry;
    if (s.kind === 'circle') {
      baseGeo = new THREE.CircleGeometry(s.r, 48);
      fillGeo = new THREE.CircleGeometry(s.r, 48);
      edgeGeo = new THREE.RingGeometry(s.r - 0.1, s.r, 48);
    } else {
      // Sector centered on local +X; rotated below so it points along the game's facing angle.
      baseGeo = new THREE.CircleGeometry(s.range, 32, -s.arc / 2, s.arc);
      fillGeo = new THREE.CircleGeometry(s.range, 32, -s.arc / 2, s.arc);
      edgeGeo = new THREE.RingGeometry(s.range - 0.1, s.range, 32, 1, -s.arc / 2, s.arc);
      group.rotation.y = s.dir - Math.PI / 2;
    }
    for (const g of [baseGeo, fillGeo, edgeGeo]) g.rotateX(-Math.PI / 2);
    const mats = [mk(0.18), mk(0.4), mk(0.9)];
    const base = new THREE.Mesh(baseGeo, mats[0]);
    const fill = new THREE.Mesh(fillGeo, mats[1]);
    const edge = new THREE.Mesh(edgeGeo, mats[2]);
    base.position.y = 0.03;
    fill.position.y = 0.04;
    edge.position.y = 0.05;
    for (const m of [base, fill, edge]) m.renderOrder = 1;
    group.add(base, fill, edge);
    group.position.set(s.x, 0, s.z);
    this.scene.add(group);

    const v = { group, fill, disposables: [baseGeo, fillGeo, edgeGeo, ...mats] };
    this.telegraphs.set(t.id, v);
    return v;
  }

  private removeTelegraph(id: number) {
    const v = this.telegraphs.get(id)!;
    this.scene.remove(v.group);
    v.disposables.forEach((d) => d.dispose());
    this.telegraphs.delete(id);
  }

  private projMatFor(color: number) {
    let m = this.projMats.get(color);
    if (!m) { m = new THREE.MeshBasicMaterial({ color }); this.projMats.set(color, m); }
    return m;
  }

  /** Combo fields: translucent elemental disc + bright rim, pulsing, fading out at the end. */
  private syncFields(w: CombatWorld) {
    const live = new Set<number>();
    for (const f of w.fields) {
      live.add(f.id);
      const v = this.fields.get(f.id) ?? this.createField(f);
      const fade = Math.min(1, f.remaining / 0.8) * Math.min(1, (f.duration - f.remaining) / 0.25 + 0.2);
      const pulse = 0.85 + 0.15 * Math.sin(this.time * 4 + f.id);
      v.mats[0].opacity = 0.22 * fade * pulse;
      v.mats[1].opacity = 0.8 * fade;
    }
    for (const id of [...this.fields.keys()]) if (!live.has(id)) this.removeField(id);
  }

  private createField(f: ComboField): FieldVisual {
    const color = ELEMENT_COLOR[f.element];
    const mk = () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const mats = [mk(), mk()];
    const disc = new THREE.Mesh(this.fieldDiscGeo, mats[0]);
    const ring = new THREE.Mesh(this.fieldRingGeo, mats[1]);
    disc.position.y = 0.06;
    ring.position.y = 0.07;
    disc.renderOrder = ring.renderOrder = 1;
    const group = new THREE.Group();
    group.add(disc, ring);
    group.position.set(f.x, 0, f.z);
    group.scale.setScalar(f.r);
    this.scene.add(group);
    const v = { group, disc, ring, mats };
    this.fields.set(f.id, v);
    return v;
  }

  private removeField(id: number) {
    const v = this.fields.get(id)!;
    this.scene.remove(v.group);
    v.mats.forEach((m) => m.dispose());
    this.fields.delete(id);
  }

  private syncProjectiles(w: CombatWorld, alpha: number) {
    const live = new Set<number>();
    for (const p of w.projectiles) {
      live.add(p.id);
      let m = this.projectiles.get(p.id);
      if (!m) {
        m = new THREE.Mesh(this.projGeo, this.projMatFor(p.combo ? ELEMENT_COLOR[p.combo] : p.skill ? new THREE.Color(p.skill.color).getHex() : 0x9fe4ff));
        if (p.comboBolt) m.scale.setScalar(0.7);
        this.scene.add(m);
        this.projectiles.set(p.id, m);
      }
      m.position.set(p.prevX + (p.x - p.prevX) * alpha, 1.3, p.prevZ + (p.z - p.prevZ) * alpha);
    }
    for (const [id, m] of this.projectiles) {
      if (!live.has(id)) { this.scene.remove(m); this.projectiles.delete(id); }
    }
  }

  private spawnText(ev: CombatEvent) {
    const el = document.createElement('div');
    el.className = `ftext ${ev.kind}`;
    el.textContent = ev.text;
    this.overlay.appendChild(el);
    // Small horizontal jitter so rapid hits don't stack perfectly.
    this.texts.push({ el, pos: new THREE.Vector3(ev.x + (Math.random() - 0.5) * 0.6, ev.y, ev.z), age: 0 });
  }
}
