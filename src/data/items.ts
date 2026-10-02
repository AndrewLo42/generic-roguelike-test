import type { Rng } from '../core/rng';
import type { PlayerStats } from '../combat/stats';

export type ItemSlot = 'weapon' | 'head' | 'chest' | 'boots' | 'trinket';
export type ItemRarity = 'common' | 'magic' | 'rare' | 'epic';
export type AffixStat =
  | 'damagePct' | 'maxHp' | 'armor' | 'moveSpeedPct' | 'critChance' | 'critDamage'
  | 'cooldownPct' | 'enduranceRegenPct' | 'lifesteal';

export interface Affix {
  stat: AffixStat;
  value: number;
}

export interface GearItem {
  uid: number;
  kind: 'gear';
  slot: ItemSlot;
  name: string;
  icon: string;
  rarity: ItemRarity;
  level: number;
  /** Implicit (from the base type) first, then rolled affixes. */
  affixes: Affix[];
}

export interface PotionItem {
  uid: number;
  kind: 'potion';
  name: string;
  icon: string;
  rarity: ItemRarity;
  count: number;
}

export type Item = GearItem | PotionItem;

export const SLOTS: ItemSlot[] = ['weapon', 'head', 'chest', 'boots', 'trinket'];
export const SLOT_LABEL: Record<ItemSlot, string> = { weapon: 'Weapon', head: 'Head', chest: 'Chest', boots: 'Boots', trinket: 'Trinket' };
export const SLOT_ICON: Record<ItemSlot, string> = { weapon: '⚔', head: '⛑', chest: '🦺', boots: '👢', trinket: '💍' };

export const ITEM_RARITY_COLOR: Record<ItemRarity, string> = {
  common: '#c8c8c8', magic: '#4fa3ff', rare: '#ffd24a', epic: '#c77dff',
};
const RARITY_MULT: Record<ItemRarity, number> = { common: 1, magic: 1.1, rare: 1.25, epic: 1.5 };
const AFFIX_COUNT: Record<ItemRarity, number> = { common: 0, magic: 1, rare: 2, epic: 3 };

export const POTION_HEAL_PCT = 0.35;
export const MAX_POTION_STACK = 20;

// ---------- Affixes ----------

interface AffixDef {
  label: (v: number) => string;
  /** Raw roll before rarity multiplier; `level` is the floor the item dropped on. */
  roll: (rng: Rng, level: number) => number;
  slots?: ItemSlot[]; // restrict where it can roll
}

const pct = (v: number) => `${v}%`;

export const AFFIXES: Record<AffixStat, AffixDef> = {
  damagePct: { label: (v) => `+${pct(v)} damage`, roll: (r, l) => r.int(4, 8) + l * 0.6 },
  maxHp: { label: (v) => `+${v} max HP`, roll: (r, l) => r.int(10, 20) + l * 4 },
  armor: { label: (v) => `+${v} armor`, roll: (r, l) => r.int(8, 15) + l * 3, slots: ['head', 'chest', 'boots', 'trinket'] },
  moveSpeedPct: { label: (v) => `+${pct(v)} movement speed`, roll: (r) => r.int(3, 6), slots: ['boots', 'trinket'] },
  critChance: { label: (v) => `+${pct(v)} critical chance`, roll: (r) => r.int(2, 5) },
  critDamage: { label: (v) => `+${pct(v)} critical damage`, roll: (r) => r.int(10, 25), slots: ['weapon', 'trinket', 'head'] },
  cooldownPct: { label: (v) => `−${pct(v)} skill cooldowns`, roll: (r) => r.int(3, 7), slots: ['head', 'trinket', 'weapon'] },
  enduranceRegenPct: { label: (v) => `+${pct(v)} endurance regen`, roll: (r) => r.int(10, 25), slots: ['boots', 'chest', 'trinket'] },
  lifesteal: { label: (v) => `+${pct(v)} lifesteal`, roll: (r) => r.int(1, 3), slots: ['weapon', 'trinket'] },
};

export const affixLabel = (a: Affix) => AFFIXES[a.stat].label(a.value);

/** Fold equipped gear into stats (called by computeStats after class + boons). */
export function applyGear(s: PlayerStats, gear: GearItem[]) {
  for (const item of gear) {
    for (const { stat, value: v } of item.affixes) {
      switch (stat) {
        case 'damagePct': s.damageMul += v / 100; break;
        case 'maxHp': s.bonusMaxHp += v; break;
        case 'armor': s.armor += v; break;
        case 'moveSpeedPct': s.moveSpeedMul += v / 100; break;
        case 'critChance': s.critChance += v / 100; break;
        case 'critDamage': s.critMul += v / 100; break;
        case 'cooldownPct': s.cooldownMul *= 1 - v / 100; break;
        case 'enduranceRegenPct': s.enduranceRegenMul += v / 100; break;
        case 'lifesteal': s.lifesteal += v / 100; break;
      }
    }
  }
}

/** Sum of each stat on an item — used for tooltip comparisons. */
export function affixTotals(item: GearItem | null | undefined): Partial<Record<AffixStat, number>> {
  const out: Partial<Record<AffixStat, number>> = {};
  for (const a of item?.affixes ?? []) out[a.stat] = (out[a.stat] ?? 0) + a.value;
  return out;
}

// ---------- Generation ----------

const PREFIX: Record<ItemRarity, string[]> = {
  common: ['Worn', 'Plain', 'Rusty', 'Simple'],
  magic: ['Fine', 'Sturdy', 'Keen', 'Polished'],
  rare: ['Gleaming', 'Runed', 'Masterwork', 'Exalted'],
  epic: ['Ancient', 'Mythic', 'Dread', 'Celestial'],
};

const WEAPON_BASES: Record<string, { names: string[]; icon: string }> = {
  warrior: { names: ['Greatsword', 'Axe', 'Warhammer', 'Mace'], icon: '⚔' },
  ranger: { names: ['Longbow', 'Shortbow', 'Recurve Bow'], icon: '🏹' },
  mage: { names: ['Staff', 'Wand', 'Scepter', 'Focus'], icon: '🪄' },
};
const ARMOR_BASES: Record<Exclude<ItemSlot, 'weapon'>, string[]> = {
  head: ['Helm', 'Hood', 'Circlet', 'Cowl'],
  chest: ['Hauberk', 'Robe', 'Jerkin', 'Breastplate'],
  boots: ['Boots', 'Greaves', 'Treads', 'Sandals'],
  trinket: ['Amulet', 'Ring', 'Charm', 'Talisman'],
};

const pick = <T>(rng: Rng, arr: T[]) => arr[Math.floor(rng.next() * arr.length)];

export type RarityWeights = Record<ItemRarity, number>;
export const ENEMY_RARITY: RarityWeights = { common: 55, magic: 30, rare: 12, epic: 3 };
export const CHEST_RARITY: RarityWeights = { common: 0, magic: 50, rare: 35, epic: 15 };
export const GOLD_CHEST_RARITY: RarityWeights = { common: 0, magic: 0, rare: 65, epic: 35 };

/** Deeper floors shift weight from common toward rare/epic. */
export function rollRarity(rng: Rng, weights: RarityWeights, level: number): ItemRarity {
  const shift = Math.min(25, (level - 1) * 3);
  const w: RarityWeights = {
    common: Math.max(0, weights.common - shift),
    magic: weights.magic,
    rare: weights.rare + (weights.common > 0 ? shift * 0.7 : shift * 0.5),
    epic: weights.epic + (weights.common > 0 ? shift * 0.3 : shift * 0.5),
  };
  const total = w.common + w.magic + w.rare + w.epic;
  let roll = rng.next() * total;
  for (const r of ['common', 'magic', 'rare', 'epic'] as ItemRarity[]) {
    if ((roll -= w[r]) < 0) return r;
  }
  return 'epic';
}

let nextUid = 1;
export const newUid = () => nextUid++;

export function makePotion(count = 1): PotionItem {
  return { uid: newUid(), kind: 'potion', name: 'Health Potion', icon: '🧪', rarity: 'common', count };
}

/**
 * Roll a gear item. Each slot has an implicit stat (weapon: damage, armor pieces: armor + HP,
 * boots: armor + speed); rarity adds random affixes and scales every value.
 */
export function generateGear(rng: Rng, level: number, classId: string, rarity: ItemRarity, slot?: ItemSlot): GearItem {
  slot ??= pick(rng, SLOTS);
  const m = RARITY_MULT[rarity];
  const scale = (v: number) => Math.max(1, Math.round(v * m));

  let base: string, icon: string;
  const implicit: Affix[] = [];
  if (slot === 'weapon') {
    const w = WEAPON_BASES[classId] ?? WEAPON_BASES.warrior;
    base = pick(rng, w.names);
    icon = w.icon;
    implicit.push({ stat: 'damagePct', value: scale(6 + level * 1.5) });
  } else {
    base = pick(rng, ARMOR_BASES[slot]);
    icon = SLOT_ICON[slot];
    if (slot === 'head') implicit.push({ stat: 'armor', value: scale(10 + level * 3) }, { stat: 'maxHp', value: scale(10 + level * 4) });
    if (slot === 'chest') implicit.push({ stat: 'armor', value: scale(18 + level * 5) }, { stat: 'maxHp', value: scale(20 + level * 6) });
    if (slot === 'boots') implicit.push({ stat: 'armor', value: scale(8 + level * 2) }, { stat: 'moveSpeedPct', value: scale(3) });
  }

  // Random affixes: distinct stats valid for this slot (trinkets get one bonus affix — no implicit).
  const count = AFFIX_COUNT[rarity] + (slot === 'trinket' ? 1 : 0);
  const pool = (Object.keys(AFFIXES) as AffixStat[]).filter((k) => {
    const allowed = AFFIXES[k].slots;
    return !allowed || allowed.includes(slot!);
  });
  const rolled: Affix[] = [];
  for (let i = 0; i < count && pool.length; i++) {
    const stat = pool.splice(Math.floor(rng.next() * pool.length), 1)[0];
    rolled.push({ stat, value: scale(AFFIXES[stat].roll(rng, level)) });
  }

  return {
    uid: newUid(), kind: 'gear', slot, rarity, level, icon,
    name: `${pick(rng, PREFIX[rarity])} ${base}`,
    affixes: [...implicit, ...rolled],
  };
}
