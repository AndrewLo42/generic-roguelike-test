import * as THREE from 'three';
import type { ClassDef } from '../data/classes';
import type { CombatWorld } from '../combat/world';
import { isInvulnerable, playerTuning, type PlayerState } from '../systems/player';
import { instantiateCharacter } from './assets';
import { AnimatedModel, impactTimeScale } from './animatedModel';
import { has } from '../combat/status';

/**
 * The player's visual: a KayKit character driven by simulation state, or a capsule placeholder
 * if models aren't available. Reads PlayerState/CombatWorld, never writes them (except draining
 * skillEvents, which exist only for the view).
 */
export class PlayerView {
  readonly group = new THREE.Group();
  private model: AnimatedModel | null = null;
  private visualRoot: THREE.Object3D | null = null;
  private materials: THREE.MeshStandardMaterial[] = [];
  private cls: ClassDef | null = null;
  private wasDodging = false;
  private stealthed = false;
  private wasDead = false;
  private lastHp = 0;
  // Placeholder
  private capsule: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    this.capsule = new THREE.Mesh(
      new THREE.CapsuleGeometry(playerTuning.radius, 1.0, 6, 16),
      new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.6 }),
    );
    this.capsule.position.y = 0.95;
    this.capsule.castShadow = true;
    scene.add(this.group);
  }

  setClass(cls: ClassDef) {
    if (this.cls === cls && (this.model || this.capsule.parent)) return;
    this.cls = cls;
    if (this.visualRoot) this.group.remove(this.visualRoot);
    this.model?.dispose();
    this.model = null;
    this.group.remove(this.capsule);

    const inst = instantiateCharacter(cls.visual);
    if (inst) {
      this.visualRoot = inst.root;
      this.materials = inst.materials;
      this.model = new AnimatedModel(inst.root, inst.clips);
      this.model.setBase(cls.visual.idle);
      this.group.add(inst.root);
    } else {
      this.visualRoot = null;
      (this.capsule.material as THREE.MeshStandardMaterial).color.setHex(cls.color);
      this.group.add(this.capsule);
    }
    this.resetRun();
  }

  /** Clear per-run animation state (new floor / new run). */
  resetRun() {
    this.wasDodging = false;
    this.setStealthed(false);
    this.wasDead = false;
    this.lastHp = Infinity;
    this.model?.stopOverlay();
    this.group.rotation.x = 0;
  }

  update(p: PlayerState, w: CombatWorld, pos: THREE.Vector3, dt: number) {
    this.group.position.copy(pos);
    this.group.rotation.y = p.facing;
    const dodging = isInvulnerable(p);

    if (!this.model) {
      this.capsule.scale.set(1, dodging ? 0.6 : 1, 1);
      this.group.rotation.x = w.dead ? -Math.PI / 2 : 0;
      if (w.dead) this.group.position.y = 0.5;
      w.skillEvents.length = 0;
      return;
    }
    const m = this.model;
    const cls = this.cls!;

    // ---- one-shots (priority: death > dodge > skills > hit reaction) ----
    if (w.dead && !this.wasDead) m.playOnce('Death_A', { persistent: true });
    this.wasDead = w.dead;

    if (!w.dead) {
      if (dodging && !this.wasDodging) {
        const clip = this.dodgeClip(p);
        m.playOnce(clip, { timeScale: (m.clip(clip)?.duration ?? 0.4) / playerTuning.dodgeDuration });
      }

      for (const skill of w.skillEvents) {
        if (!skill.anim) continue;
        const ts = impactTimeScale(m.clip(skill.anim), skill.animImpact ?? 0.5, skill.castTime);
        m.playOnce(skill.anim, { timeScale: ts, part: skill.animFullBody || !p.moving ? 'full' : 'upper' });
      }

      if (w.hp < this.lastHp - 0.5 && this.lastHp !== Infinity && !m.overlayName) {
        m.playOnce('Hit_A', { part: 'upper', timeScale: 1.4 });
      }
    }
    w.skillEvents.length = 0;
    this.wasDodging = dodging;
    this.lastHp = w.hp;

    // ---- locomotion base ----
    const speed = Math.hypot(p.x - p.prevX, p.z - p.prevZ) / (1 / 60);
    if (!p.grounded && !p.leap) m.setBase('Jump_Idle');
    else if (speed > 0.5) {
      // Direction of travel relative to facing picks run / backpedal / strafe.
      const mx = (p.x - p.prevX), mz = (p.z - p.prevZ), l = Math.hypot(mx, mz) || 1;
      const fwd = (mx * Math.sin(p.facing) + mz * Math.cos(p.facing)) / l;
      const right = (mx * -Math.cos(p.facing) + mz * Math.sin(p.facing)) / l;
      const rate = speed / playerTuning.moveSpeed;
      if (fwd > 0.5) m.setBase(cls.visual.move, rate);
      else if (fwd < -0.5) m.setBase('Walking_Backwards', rate * 1.3);
      else m.setBase(right > 0 ? 'Running_Strafe_Right' : 'Running_Strafe_Left', rate);
    } else {
      m.setBase(cls.visual.idle);
    }

    // Brief white flash while invulnerable so i-frames are readable.
    for (const mat of this.materials) mat.emissive.setScalar(dodging ? 0.15 : 0);
    this.setStealthed(has(w.playerStatus, 'stealth'));
    m.update(dt);
  }

  /** Stealth: translucent with a faint violet tint. Toggling transparency needs a shader rebuild. */
  private setStealthed(on: boolean) {
    if (on === this.stealthed) return;
    this.stealthed = on;
    for (const mat of this.materials) {
      mat.transparent = on;
      mat.opacity = on ? 0.28 : 1;
      mat.depthWrite = !on;
      mat.color.setHex(on ? 0xb9a0ff : 0xffffff);
      mat.needsUpdate = true;
    }
  }

  private dodgeClip(p: PlayerState) {
    const fwd = p.dodgeDirX * Math.sin(p.facing) + p.dodgeDirZ * Math.cos(p.facing);
    const right = p.dodgeDirX * -Math.cos(p.facing) + p.dodgeDirZ * Math.sin(p.facing);
    if (Math.abs(fwd) >= Math.abs(right)) return fwd >= 0 ? 'Dodge_Forward' : 'Dodge_Backward';
    return right > 0 ? 'Dodge_Right' : 'Dodge_Left';
  }
}
