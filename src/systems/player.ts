import type { Input } from '../core/input';
import type { Dungeon } from '../world/dungeon/generator';
import { resolveCircleVsWalls } from '../world/collision';
import { BASE_STATS, type PlayerStats } from '../combat/stats';
import type { SkillDef } from '../data/skills';

export const playerTuning = {
  moveSpeed: 7,
  turnRate: 14, // rad/s-ish smoothing factor for facing
  dodgeSpeed: 17,
  dodgeDuration: 0.38,
  dodgeCost: 50,
  enduranceMax: 100,
  enduranceRegen: 20, // per second
  radius: 0.45,
  jumpVelocity: 7,
  gravity: 22,
};

export interface Leap {
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  t: number;
  dur: number;
  height: number;
  /** Face the travel direction (false for backward hops, which keep facing the enemy). */
  faceTravel: boolean;
  /** Landing AoE; damage 0 = none. */
  landRadius: number;
  landDamage: number;
  /** Counts as a leap combo finisher on landing. */
  finisher: boolean;
  /** The skill that started the leap (landing statuses, damage family). */
  skill?: SkillDef;
}

/** Plain-data player state; rendering reads this, never writes it. */
export interface PlayerState {
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  y: number; // height above floor
  prevY: number;
  vy: number;
  grounded: boolean;
  facing: number; // radians, 0 = +Z
  endurance: number;
  dodgeTime: number; // > 0 while rolling
  dodgeDirX: number;
  dodgeDirZ: number;
  moving: boolean;
  /** Scripted leap/blink movement; overrides input while active. */
  leap: Leap | null;
  /** Set for exactly one tick when a leap lands (combat applies its landing effect). */
  landed: Leap | null;
  /** Run-long boon modifiers (shared, read-only here). */
  stats: PlayerStats;
  /** Temporary speed multiplier from boons (Swiftness), set by combat each tick. */
  speedMul: number;
}

export const maxEnduranceOf = (p: PlayerState) => playerTuning.enduranceMax + p.stats.bonusEndurance;

export function createPlayer(x: number, z: number, stats: PlayerStats = { ...BASE_STATS }): PlayerState {
  return {
    x, z, prevX: x, prevZ: z, y: 0, prevY: 0, vy: 0, grounded: true, facing: 0,
    endurance: playerTuning.enduranceMax + stats.bonusEndurance,
    dodgeTime: 0, dodgeDirX: 0, dodgeDirZ: 1, moving: false,
    leap: null, landed: null, stats, speedMul: 1,
  };
}

/** Invulnerability window is the dodge itself — combat will query this. */
export const isInvulnerable = (p: PlayerState) => p.dodgeTime > 0;

/**
 * @param faceCamera  turn to face camera-forward (RMB steering, or Q/E keyboard turning)
 * @param strafeQE    Q/E strafe instead of turning (true while RMB is held)
 * @param faceTarget  facing angle to lock to while casting at a target (null = free facing)
 */
export function updatePlayer(
  p: PlayerState, input: Input, camYaw: number, faceCamera: boolean, strafeQE: boolean, d: Dungeon, dt: number,
  faceTarget: number | null = null,
) {
  const t = playerTuning;
  p.prevX = p.x;
  p.prevZ = p.z;
  p.prevY = p.y;
  p.landed = null;

  if (p.leap) {
    const l = p.leap;
    l.t += dt;
    const k = Math.min(1, l.t / l.dur);
    p.x = l.fromX + (l.toX - l.fromX) * k;
    p.z = l.fromZ + (l.toZ - l.fromZ) * k;
    p.y = 4 * k * (1 - k) * l.height; // parabolic hop
    if (l.faceTravel) p.facing = Math.atan2(l.toX - l.fromX, l.toZ - l.fromZ);
    resolveCircleVsWalls(d, p, t.radius);
    if (k >= 1) {
      p.leap = null;
      p.y = 0;
      p.vy = 0;
      p.grounded = true;
      p.landed = l;
    }
    return;
  }

  // Camera-relative input. Camera sits at +Z of the player when yaw = 0, looking toward -Z.
  const fwdX = -Math.sin(camYaw), fwdZ = -Math.cos(camYaw);
  const rightX = Math.cos(camYaw), rightZ = -Math.sin(camYaw);
  let ix = 0, iz = 0;
  if (input.isDown('KeyW')) { ix += fwdX; iz += fwdZ; }
  if (input.isDown('KeyS')) { ix -= fwdX; iz -= fwdZ; }
  // A/D always strafe; Q/E strafe only while RMB-steering (otherwise they turn — see camera.ts).
  if (input.isDown('KeyD') || (strafeQE && input.isDown('KeyE'))) { ix += rightX; iz += rightZ; }
  if (input.isDown('KeyA') || (strafeQE && input.isDown('KeyQ'))) { ix -= rightX; iz -= rightZ; }
  const len = Math.hypot(ix, iz);
  if (len > 0) { ix /= len; iz /= len; }
  p.moving = len > 0;

  // Dodge: rolls in the input direction, or backwards if standing still (GW2 behavior).
  const dodgePressed = input.wasPressed('KeyV') || input.wasPressed('ShiftLeft') || input.wasPressed('ShiftRight');
  if (dodgePressed && p.dodgeTime <= 0 && p.endurance >= t.dodgeCost) {
    p.endurance -= t.dodgeCost;
    p.dodgeTime = t.dodgeDuration;
    if (p.moving) { p.dodgeDirX = ix; p.dodgeDirZ = iz; }
    else { p.dodgeDirX = -Math.sin(p.facing); p.dodgeDirZ = -Math.cos(p.facing); }
  }

  if (p.dodgeTime > 0) {
    p.dodgeTime -= dt;
    p.x += p.dodgeDirX * t.dodgeSpeed * dt;
    p.z += p.dodgeDirZ * t.dodgeSpeed * dt;
  } else {
    const speed = t.moveSpeed * p.stats.moveSpeedMul * p.speedMul;
    p.x += ix * speed * dt;
    p.z += iz * speed * dt;
    p.endurance = Math.min(maxEnduranceOf(p), p.endurance + t.enduranceRegen * p.stats.enduranceRegenMul * dt);
  }

  resolveCircleVsWalls(d, p, t.radius);

  // Jump + gravity. Walls are taller than a jump, so no vertical collision beyond the floor.
  if (input.wasPressed('Space') && p.grounded && p.dodgeTime <= 0) {
    p.vy = t.jumpVelocity;
    p.grounded = false;
  }
  if (!p.grounded) {
    p.vy -= t.gravity * dt;
    p.y += p.vy * dt;
    if (p.y <= 0) {
      p.y = 0;
      p.vy = 0;
      p.grounded = true;
    }
  }

  // Facing: cast target > camera forward (RMB / A-D turning) > movement direction.
  let targetFacing: number | null = null;
  let lockToCamera = false;
  if (faceTarget !== null && p.dodgeTime <= 0) targetFacing = faceTarget;
  else if (faceCamera) { targetFacing = Math.atan2(fwdX, fwdZ); lockToCamera = true; }
  else if (p.moving && p.dodgeTime <= 0) targetFacing = Math.atan2(ix, iz);
  if (targetFacing !== null) {
    const diff = Math.atan2(Math.sin(targetFacing - p.facing), Math.cos(targetFacing - p.facing));
    // Once caught up with the camera, track it exactly so Q/E turning doesn't trail behind;
    // bigger gaps (e.g. starting to steer from a different facing) still swing smoothly.
    if (lockToCamera && Math.abs(diff) < 0.4) p.facing = targetFacing;
    else p.facing += diff * Math.min(1, t.turnRate * dt);
  }
}
