import { describe, expect, it } from 'vitest';
import { SKILL_LIBRARY as L } from '../data/skills';
import { carryCooldowns } from './cooldowns';

describe('cooldown carry-over on swaps and re-slotting', () => {
  it('kept skills keep their cooldown; swapped-out skills keep ticking and come back with the remainder', () => {
    const stash = new Map<string, number>();
    const gs = [L.cleave, L.savageLeap, L.flameBrand];
    const sns = [L.swordSlash, L.lunge, L.flameBrand];
    // t=10: swap greatsword -> sword & shield with Savage Leap at 6s and Flame Brand (utility) at 4s.
    let cds = carryCooldowns(gs, [0, 6, 4], sns, stash, 10);
    expect(cds).toEqual([0, 0, 4]);
    // t=13: swap back — Savage Leap has 3s left, Flame Brand 1s.
    cds = carryCooldowns(sns, [0, 0, 1], gs, stash, 13);
    expect(cds).toEqual([0, 3, 1]);
    // t=30: everything long since ready.
    expect(carryCooldowns(gs, [0, 0, 0], sns, stash, 30)).toEqual([0, 0, 0]);
  });
});
