import { Rng } from '../core/rng';
import { BASE_STATS, type PlayerStats } from '../combat/stats';
import type { SkillKind } from './skills';
import type { ClassDef } from './classes';
import { applyGear, type GearItem } from './items';
import { type MetaRanks, applyMeta } from './meta';
import { type TraitPicks, applyTraits } from './traits';

export type Rarity = 'common' | 'rare' | 'epic';

export interface BoonDef {
  id: string;
  name: string;
  icon: string;
  rarity: Rarity;
  maxStacks: number;
  description: string;
  /** Only offered if the class kit has a skill of this kind. */
  requires?: SkillKind;
  /** Applied once per stack. */
  apply: (s: PlayerStats) => void;
}

export const RARITY_WEIGHT: Record<Rarity, number> = { common: 60, rare: 30, epic: 10 };

export const BOONS: BoonDef[] = [
  // --- Common: flat stat growth ---
  { id: 'edge', name: 'Sharpened Edge', icon: '🗡', rarity: 'common', maxStacks: 5,
    description: '+12% damage', apply: (s) => { s.damageMul += 0.12; } },
  { id: 'vitality', name: 'Vitality', icon: '❤', rarity: 'common', maxStacks: 5,
    description: '+40 max HP', apply: (s) => { s.bonusMaxHp += 40; } },
  { id: 'swift', name: 'Swiftness', icon: '👟', rarity: 'common', maxStacks: 3,
    description: '+10% movement speed', apply: (s) => { s.moveSpeedMul += 0.1; } },
  { id: 'breath', name: 'Second Breath', icon: '💨', rarity: 'common', maxStacks: 3,
    description: '+35% endurance regeneration', apply: (s) => { s.enduranceRegenMul += 0.35; } },
  { id: 'focus', name: 'Quickened Mind', icon: '⏳', rarity: 'common', maxStacks: 3,
    description: '−10% skill cooldowns', apply: (s) => { s.cooldownMul *= 0.9; } },
  { id: 'mending', name: 'Mending', icon: '🧪', rarity: 'common', maxStacks: 3,
    description: 'Potions heal 40% more', apply: (s) => { s.healMul += 0.4; } },

  // --- Rare: new mechanics / skill upgrades ---
  { id: 'keen', name: 'Keen Eye', icon: '🎯', rarity: 'rare', maxStacks: 3,
    description: '+12% critical hit chance', apply: (s) => { s.critChance += 0.12; } },
  { id: 'thirst', name: 'Bloodthirst', icon: '🩸', rarity: 'rare', maxStacks: 3,
    description: 'Heal for 5% of damage dealt', apply: (s) => { s.lifesteal += 0.05; } },
  { id: 'split', name: 'Split Shot', icon: '✦', rarity: 'rare', maxStacks: 2, requires: 'projectile',
    description: 'Projectile skills fire 2 extra projectiles', apply: (s) => { s.extraProjectiles += 2; } },
  { id: 'cataclysm', name: 'Cataclysm', icon: '☄', rarity: 'rare', maxStacks: 2, requires: 'groundAoe',
    description: 'Ground-targeted skills: +30% radius, +25% damage', apply: (s) => { s.groundAoeRadiusMul += 0.3; s.groundAoeDamageMul += 0.25; } },
  { id: 'predator', name: 'Light Feet', icon: '➶', rarity: 'rare', maxStacks: 2, requires: 'leap',
    description: 'Movement skills heal 20 and restore 25 endurance', apply: (s) => { s.leapHeal += 20; s.leapEndurance += 25; } },
  { id: 'riposte', name: 'Riposte', icon: '↺', rarity: 'rare', maxStacks: 2,
    description: 'Evading an attack blasts nearby foes for 30', apply: (s) => { s.riposteDamage += 30; } },

  // --- Epic: build-defining ---
  { id: 'whirl', name: 'Whirlwind', icon: '🌀', rarity: 'epic', maxStacks: 1, requires: 'cone',
    description: 'Frontal melee skills hit all around you', apply: (s) => { s.conesFullCircle = true; } },
  { id: 'glass', name: 'Glass Cannon', icon: '💎', rarity: 'epic', maxStacks: 1,
    description: '+40% damage, −25% max HP', apply: (s) => { s.damageMul += 0.4; s.maxHpMul *= 0.75; } },
  { id: 'acrobat', name: 'Acrobat', icon: '🤸', rarity: 'epic', maxStacks: 1,
    description: '+50 max endurance (a third dodge)', apply: (s) => { s.bonusEndurance += 50; } },
];

export const boonById = (id: string) => BOONS.find((b) => b.id === id)!;

/** Owned boons: id -> stack count. */
export type BoonStacks = Record<string, number>;

/** Final stats = base → class → permanent upgrades → traits → boons → equipped gear. */
export function computeStats(
  owned: BoonStacks, cls?: ClassDef, gear: GearItem[] = [], meta: MetaRanks = {}, traits: TraitPicks = [],
): PlayerStats {
  const s: PlayerStats = { ...BASE_STATS };
  if (cls) {
    s.baseHp = cls.baseHp;
    s.moveSpeedMul = cls.moveSpeedMul;
  }
  applyMeta(s, meta);
  applyTraits(s, traits);
  for (const [id, stacks] of Object.entries(owned)) {
    const def = boonById(id);
    for (let i = 0; i < stacks; i++) def.apply(s);
  }
  applyGear(s, gear);
  return s;
}

/**
 * Weighted draw of `count` distinct boons that aren't maxed out and fit the class kit
 * (`kinds` = skill kinds the class has; omit to allow all). Deterministic for a given seed.
 */
export function rollOffers(seed: number, owned: BoonStacks, count: number, kinds?: Set<SkillKind>): BoonDef[] {
  const rng = new Rng(seed);
  const pool = BOONS.filter(
    (b) => (owned[b.id] ?? 0) < b.maxStacks && (!b.requires || !kinds || kinds.has(b.requires)),
  );
  const offers: BoonDef[] = [];
  while (offers.length < count && pool.length) {
    const total = pool.reduce((n, b) => n + RARITY_WEIGHT[b.rarity], 0);
    let roll = rng.next() * total;
    const i = pool.findIndex((b) => (roll -= RARITY_WEIGHT[b.rarity]) < 0);
    offers.push(pool.splice(i < 0 ? pool.length - 1 : i, 1)[0]);
  }
  return offers;
}
