import * as THREE from 'three';
import type { Input } from '../core/input';
import type { Dungeon } from '../world/dungeon/generator';
import { WALL_HEIGHT } from '../world/dungeon/meshBuilder';
import { isWallAt } from '../world/collision';

export const cameraTuning = {
  sensitivity: 0.004,
  minPitch: 0.1,
  maxPitch: 1.3,
  minDist: 3,
  maxDist: 18,
  targetHeight: 1.6,
  smoothing: 12,
  keyTurnRate: 3, // rad/s for Q/E turning
};

/** Third-person orbit camera with a spring arm that pulls in when a wall blocks the view. */
export class ThirdPersonCamera {
  yaw = 0;
  pitch = 0.45;
  distance = 10;
  private currentDist = 10;
  private target = new THREE.Vector3();

  constructor(public camera: THREE.PerspectiveCamera) {}

  /**
   * Logic-rate update: consume mouse input, plus Q/E keyboard turning when RMB isn't held.
   * The character faces camera-forward, so rotating the camera turns the character too.
   * @returns true while Q/E are turning this tick
   */
  handleInput(input: Input, dt: number): boolean {
    const t = cameraTuning;
    let turn = 0;
    if (!input.rmb) turn = (input.isDown('KeyQ') ? 1 : 0) - (input.isDown('KeyE') ? 1 : 0);
    this.yaw += turn * t.keyTurnRate * dt;
    this.yaw -= input.mouseDX * t.sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch + input.mouseDY * t.sensitivity, t.minPitch, t.maxPitch);
    this.distance = THREE.MathUtils.clamp(this.distance + input.wheel * 1.2, t.minDist, t.maxDist);
    return turn !== 0;
  }

  /** Render-rate update: position the camera around the (interpolated) player position. */
  update(px: number, pz: number, d: Dungeon, dt: number) {
    const t = cameraTuning;
    this.target.set(px, t.targetHeight, pz);

    const dir = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );

    // Spring arm: march outward until the arm enters a wall below wall-top height.
    let allowed = this.distance;
    for (let s = 0.25; s <= this.distance; s += 0.25) {
      const x = this.target.x + dir.x * s;
      const y = this.target.y + dir.y * s;
      const z = this.target.z + dir.z * s;
      if (y < WALL_HEIGHT + 0.3 && isWallAt(d, x, z)) {
        allowed = Math.max(1, s - 0.5);
        break;
      }
    }
    // Snap in fast (avoid clipping), ease back out slowly.
    const k = allowed < this.currentDist ? 1 : 1 - Math.exp(-t.smoothing * 0.3 * dt);
    this.currentDist += (allowed - this.currentDist) * k;

    this.camera.position.copy(this.target).addScaledVector(dir, this.currentDist);
    this.camera.lookAt(this.target);
  }
}
