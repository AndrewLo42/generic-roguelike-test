import { describe, expect, it } from 'vitest';
import { shapeHits } from './shapes';

describe('shapeHits', () => {
  it('circle includes body radius', () => {
    const c = { kind: 'circle' as const, x: 0, z: 0, r: 2 };
    expect(shapeHits(c, 2.3, 0, 0.5)).toBe(true);
    expect(shapeHits(c, 2.6, 0, 0.5)).toBe(false);
  });

  it('cone hits in front, misses behind and to the side', () => {
    const cone = { kind: 'cone' as const, x: 0, z: 0, dir: 0, range: 3, arc: Math.PI / 2 };
    expect(shapeHits(cone, 0, 2, 0.4)).toBe(true); // straight ahead (+Z)
    expect(shapeHits(cone, 0, -2, 0.4)).toBe(false); // behind
    expect(shapeHits(cone, 2, 0.2, 0.1)).toBe(false); // ~84° off-axis
    expect(shapeHits(cone, 0, 3.8, 0.4)).toBe(false); // out of range
  });

  it('cone respects direction', () => {
    const cone = { kind: 'cone' as const, x: 0, z: 0, dir: Math.PI / 2, range: 3, arc: Math.PI / 3 };
    expect(shapeHits(cone, 2, 0, 0.3)).toBe(true); // +X
    expect(shapeHits(cone, 0, 2, 0.3)).toBe(false);
  });
});
