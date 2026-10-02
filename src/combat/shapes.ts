/** Hit shapes on the XZ plane. Angles use the game convention: 0 = +Z, dir vector = (sin a, cos a). */
export type Shape =
  | { kind: 'circle'; x: number; z: number; r: number }
  | { kind: 'cone'; x: number; z: number; dir: number; range: number; arc: number };

export const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

/** Does a body (circle of `radius` at x,z) overlap the shape? */
export function shapeHits(s: Shape, x: number, z: number, radius: number): boolean {
  const dx = x - s.x, dz = z - s.z;
  const dist = Math.hypot(dx, dz);
  if (s.kind === 'circle') return dist <= s.r + radius;
  if (dist > s.range + radius) return false;
  if (dist <= radius) return true;
  // Widen the arc by the body's angular size so edge-grazes count.
  const slack = Math.asin(Math.min(1, radius / dist));
  return Math.abs(angleDiff(Math.atan2(dx, dz), s.dir)) <= s.arc / 2 + slack;
}
