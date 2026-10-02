import * as THREE from 'three';

const POOL = 6;
const RANGE = 11;

/**
 * A fixed pool of point lights that hop to the torches nearest the player. The light count never
 * changes (which would force shader recompiles); unused lights just go dark.
 */
export class TorchLights {
  private lights: THREE.PointLight[] = [];
  private torches: THREE.Vector3[] = [];
  private time = 0;
  private resortIn = 0;

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < POOL; i++) {
      const l = new THREE.PointLight(0xff9a40, 0, RANGE, 1.6);
      scene.add(l);
      this.lights.push(l);
    }
  }

  setTorches(t: THREE.Vector3[]) {
    this.torches = t;
    this.resortIn = 0;
  }

  update(px: number, pz: number, dt: number) {
    this.time += dt;
    if ((this.resortIn -= dt) <= 0) {
      this.resortIn = 0.3;
      const nearest = [...this.torches]
        .sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz))
        .slice(0, POOL);
      this.lights.forEach((l, i) => {
        const t = nearest[i];
        l.userData.on = !!t;
        if (t) l.position.copy(t);
      });
    }
    // Per-light flicker from layered sines (cheap and stable).
    this.lights.forEach((l, i) => {
      const f = 1 + Math.sin(this.time * 9 + i * 1.7) * 0.08 + Math.sin(this.time * 23 + i * 3.1) * 0.05;
      l.intensity = l.userData.on ? 7 * f : 0;
    });
  }
}
