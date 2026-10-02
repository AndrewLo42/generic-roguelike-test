import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Input } from '../core/input';
import { generateDungeon, roomCenter } from '../world/dungeon/generator';
import { tileToWorld } from '../world/dungeon/meshBuilder';
import { ThirdPersonCamera } from './camera';
import { createPlayer, updatePlayer } from './player';

/** Minimal Input stand-in: a set of held keys, optional RMB. */
function fakeInput(keys: string[], rmb = false): Input {
  const held = new Set(keys);
  return {
    isDown: (c: string) => held.has(c), wasPressed: () => false,
    mouseDX: 0, mouseDY: 0, wheel: 0, rmb, leftClick: null, endTick: () => {},
  } as unknown as Input;
}

const DT = 1 / 60;
const d = generateDungeon(42);

function setup() {
  const [sx, sy] = roomCenter(d.rooms[d.startRoom]);
  const spawn = tileToWorld(sx, sy);
  return { cam: new ThirdPersonCamera(new THREE.PerspectiveCamera()), p: createPlayer(spawn.x, spawn.z) };
}

/** Run n ticks the same way main.ts does. */
function run(cam: ThirdPersonCamera, p: ReturnType<typeof createPlayer>, input: Input, n: number) {
  for (let i = 0; i < n; i++) {
    const turning = cam.handleInput(input, DT);
    updatePlayer(p, input, cam.yaw, input.rmb || turning, input.rmb, d, DT);
  }
}

describe('keyboard controls', () => {
  it('Q/E turn in place (no movement) and the character faces camera-forward', () => {
    const { cam, p } = setup();
    const x0 = p.x, z0 = p.z;
    run(cam, p, fakeInput(['KeyQ']), 30);
    expect(cam.yaw).toBeGreaterThan(0); // Q turns left
    expect(p.x).toBeCloseTo(x0);
    expect(p.z).toBeCloseTo(z0);
    const camForward = Math.atan2(-Math.sin(cam.yaw), -Math.cos(cam.yaw));
    expect(Math.abs(Math.atan2(Math.sin(p.facing - camForward), Math.cos(p.facing - camForward)))).toBeLessThan(0.05);

    const yawAfterQ = cam.yaw;
    run(cam, p, fakeInput(['KeyE']), 30);
    expect(cam.yaw).toBeLessThan(yawAfterQ); // E turns right
  });

  it('Q/E strafe (and do not turn) while RMB is held', () => {
    const { cam, p } = setup();
    const x0 = p.x;
    run(cam, p, fakeInput(['KeyE'], true), 20);
    expect(cam.yaw).toBe(0);
    expect(p.x).toBeGreaterThan(x0 + 1); // camera right at yaw 0 is +X
  });

  it('A/D always strafe without turning', () => {
    const { cam, p } = setup();
    const x0 = p.x;
    run(cam, p, fakeInput(['KeyA']), 20);
    expect(cam.yaw).toBe(0);
    expect(p.x).toBeLessThan(x0 - 1);
  });
});
