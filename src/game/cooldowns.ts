import type { SkillDef } from '../data/skills';

/**
 * Cooldowns for a new skill bar after a loadout change or weapon swap. Skills leaving the bar stash
 * the time they'd be ready (`stash`: skill id -> time); skills on the new bar read it back, so
 * cooldowns keep ticking while a skill is swapped out and re-slotting can't reset them.
 */
export function carryCooldowns(oldKit: SkillDef[], oldCds: number[], next: SkillDef[], stash: Map<string, number>, now: number): number[] {
  oldKit.forEach((s, i) => {
    if (oldCds[i] > 0) stash.set(s.id, now + oldCds[i]);
    else stash.delete(s.id);
  });
  return next.map((s) => Math.max(0, (stash.get(s.id) ?? 0) - now));
}
