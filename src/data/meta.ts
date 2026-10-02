import type { PlayerStats } from '../combat/stats';

/**
 * Permanent upgrades bought with Soul Shards between runs. Each has ranks; cost grows per rank.
 * Stat upgrades fold into PlayerStats (after class, before boons/gear); the rest are read
 * directly by the run setup (potions, starting boons, drop rate, shard gain, revive).
 */
export interface MetaUpgradeDef {
  id: string;
  name: string;
  icon: string;
  maxRank: number;
  baseCost: number;
  /** Total effect at a given rank, for display ("+12% max HP"). */
  effect: (rank: number) => string;
  apply?: (s: PlayerStats, rank: number) => void;
}

export const META_UPGRADES: MetaUpgradeDef[] = [
  { id: 'vitality', name: 'Vitality', icon: '❤', maxRank: 10, baseCost: 15,
    effect: (r) => `+${r * 6}% max HP`, apply: (s, r) => { s.maxHpMul *= 1 + 0.06 * r; } },
  { id: 'might', name: 'Might', icon: '🗡', maxRank: 10, baseCost: 15,
    effect: (r) => `+${r * 5}% damage`, apply: (s, r) => { s.damageMul += 0.05 * r; } },
  { id: 'fortitude', name: 'Fortitude', icon: '🛡', maxRank: 10, baseCost: 15,
    effect: (r) => `+${r * 6} armor`, apply: (s, r) => { s.armor += 6 * r; } },
  { id: 'swiftness', name: 'Swiftness', icon: '👟', maxRank: 5, baseCost: 20,
    effect: (r) => `+${r * 3}% movement speed`, apply: (s, r) => { s.moveSpeedMul += 0.03 * r; } },
  { id: 'focus', name: 'Focus', icon: '⏳', maxRank: 5, baseCost: 25,
    effect: (r) => `−${Math.round((1 - 0.96 ** r) * 100)}% skill cooldowns`, apply: (s, r) => { s.cooldownMul *= 0.96 ** r; } },
  { id: 'precision', name: 'Precision', icon: '🎯', maxRank: 5, baseCost: 20,
    effect: (r) => `+${r * 2}% critical chance`, apply: (s, r) => { s.critChance += 0.02 * r; } },
  { id: 'stamina', name: 'Stamina', icon: '💨', maxRank: 5, baseCost: 15,
    effect: (r) => `+${r * 15}% endurance regen`, apply: (s, r) => { s.enduranceRegenMul += 0.15 * r; } },
  { id: 'provisions', name: 'Provisions', icon: '🧪', maxRank: 3, baseCost: 20,
    effect: (r) => `+${r} starting potion${r === 1 ? '' : 's'}` },
  { id: 'scavenger', name: 'Scavenger', icon: '🔎', maxRank: 5, baseCost: 25,
    effect: (r) => `+${r * 12}% item drop chance` },
  { id: 'fortune', name: 'Fortune', icon: '💠', maxRank: 5, baseCost: 30,
    effect: (r) => `+${r * 10}% Soul Shards earned` },
  { id: 'blessing', name: 'Blessing', icon: '✨', maxRank: 2, baseCost: 60,
    effect: (r) => `Start each run with ${r} random boon${r === 1 ? '' : 's'}` },
  { id: 'undying', name: 'Undying', icon: '💀', maxRank: 1, baseCost: 150,
    effect: (r) => (r ? 'Once per run, survive a killing blow at 35% HP' : 'Cheat death once per run') },
];

export const metaById = (id: string) => META_UPGRADES.find((u) => u.id === id);

export type MetaRanks = Record<string, number>;

export const rankOf = (ranks: MetaRanks, id: string) => ranks[id] ?? 0;

/** Cost to buy the next rank (from `rank` to `rank + 1`), rounded to 5. */
export const upgradeCost = (def: MetaUpgradeDef, rank: number) => Math.round((def.baseCost * 1.55 ** rank) / 5) * 5;

/** Total shards spent to reach `rank` (for refunds). */
export function spentOn(def: MetaUpgradeDef, rank: number) {
  let n = 0;
  for (let r = 0; r < rank; r++) n += upgradeCost(def, r);
  return n;
}

export function applyMeta(s: PlayerStats, ranks: MetaRanks) {
  for (const def of META_UPGRADES) {
    const r = rankOf(ranks, def.id);
    if (r > 0) def.apply?.(s, r);
  }
}

// ---------- Run rewards ----------

export interface RunSummary {
  classId: string;
  floor: number; // floor the run ended on
  kills: number;
  bruteKills: number;
  chests: number;
  goldChests: number;
}

/**
 * Deeper floors are worth progressively more; kills and chests add a bit on top.
 * Fortune multiplies the total.
 */
export function shardsForRun(r: RunSummary, ranks: MetaRanks): { total: number; breakdown: [string, number][] } {
  const cleared = Math.max(0, r.floor - 1);
  let depth = 0;
  for (let f = 1; f <= cleared; f++) depth += 10 + 5 * f;
  const breakdown: [string, number][] = [
    [`Floors cleared (${cleared})`, depth],
    [`Enemies slain (${r.kills})`, r.kills + r.bruteKills * 2],
    [`Chests opened (${r.chests})`, (r.chests - r.goldChests) * 4 + r.goldChests * 10],
  ];
  const base = breakdown.reduce((n, [, v]) => n + v, 0);
  const fortune = rankOf(ranks, 'fortune');
  const bonus = Math.round(base * 0.1 * fortune);
  if (bonus) breakdown.push([`Fortune (+${fortune * 10}%)`, bonus]);
  return { total: base + bonus, breakdown };
}
