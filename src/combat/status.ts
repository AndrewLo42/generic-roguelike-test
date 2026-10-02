/**
 * Status effects (GW2-style conditions on enemies, boons on the player).
 * Stored as plain maps so they serialize and test easily.
 */
export type EnemyStatusId = 'burning' | 'chill' | 'vulnerability';
export type PlayerStatusId = 'might' | 'regeneration' | 'swiftness' | 'protection';
export type StatusId = EnemyStatusId | PlayerStatusId;

export interface StatusInstance {
  stacks: number;
  /** Seconds remaining (refreshed to the longer duration when reapplied). */
  t: number;
  /** Accumulator for once-per-second ticks (burning, regeneration). */
  tick: number;
}

export type StatusMap = Partial<Record<StatusId, StatusInstance>>;

export interface StatusDef {
  name: string;
  icon: string;
  color: string;
  maxStacks: number;
  describe: (stacks: number) => string;
}

export const STATUS: Record<StatusId, StatusDef> = {
  burning: { name: 'Burning', icon: '🔥', color: '#ff7a2f', maxStacks: 10, describe: (n) => `${n * BURN_DPS_PER_STACK} damage/s` },
  chill: { name: 'Chilled', icon: '❄', color: '#7fd8ff', maxStacks: 1, describe: () => '−45% movement speed' },
  vulnerability: { name: 'Vulnerable', icon: '🔻', color: '#c77dff', maxStacks: 10, describe: (n) => `+${n * 5}% damage taken` },
  might: { name: 'Might', icon: '💪', color: '#ff9a40', maxStacks: 15, describe: (n) => `+${n * 3}% damage` },
  regeneration: { name: 'Regeneration', icon: '✚', color: '#6ee07a', maxStacks: 1, describe: () => `Heal ${REGEN_PCT * 100}% max HP/s` },
  swiftness: { name: 'Swiftness', icon: '👟', color: '#ffe066', maxStacks: 1, describe: () => '+33% movement speed' },
  protection: { name: 'Protection', icon: '🛡', color: '#9fb4ff', maxStacks: 1, describe: () => '−33% damage taken' },
};

export const BURN_DPS_PER_STACK = 4;
export const REGEN_PCT = 0.025;
export const CHILL_SLOW = 0.55; // speed multiplier while chilled

export function applyStatus(map: StatusMap, id: StatusId, stacks: number, duration: number) {
  const def = STATUS[id];
  const cur = map[id];
  if (cur) {
    cur.stacks = Math.min(def.maxStacks, cur.stacks + stacks);
    cur.t = Math.max(cur.t, duration);
  } else {
    map[id] = { stacks: Math.min(def.maxStacks, stacks), t: duration, tick: 0 };
  }
}

export const stacksOf = (map: StatusMap, id: StatusId) => map[id]?.stacks ?? 0;
export const has = (map: StatusMap, id: StatusId) => (map[id]?.t ?? 0) > 0;

/**
 * Advance timers. Calls `onTick(id, stacks)` once per elapsed second for periodic effects.
 * Expired statuses are removed.
 */
export function tickStatuses(map: StatusMap, dt: number, onTick?: (id: StatusId, stacks: number) => void) {
  for (const id of Object.keys(map) as StatusId[]) {
    const s = map[id]!;
    s.t -= dt;
    s.tick += dt;
    while (s.tick >= 1) {
      s.tick -= 1;
      onTick?.(id, s.stacks);
    }
    if (s.t <= 0) delete map[id];
  }
}
