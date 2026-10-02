import type { PlayerStats } from '../combat/stats';

/**
 * GW2-style trait line: each class has 4 tiers, pick one trait per tier. Free to swap (no
 * points yet). Traits are stat modifiers that the combat code reads (see combat/stats.ts).
 */
export interface TraitDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  apply: (s: PlayerStats) => void;
}

const T = (d: TraitDef) => d;

export const TRAITS = {
  // Offense
  brawler: T({ id: 'brawler', name: 'Brawler', icon: '⚔', desc: '+20% melee (cone) damage', apply: (s) => { s.coneDamageMul += 0.2; } }),
  marksman: T({ id: 'marksman', name: 'Marksman', icon: '🎯', desc: '+20% projectile damage', apply: (s) => { s.projectileDamageMul += 0.2; } }),
  pyromancy: T({ id: 'pyromancy', name: 'Devastation', icon: '☄', desc: '+20% area damage (ground & self AoE)', apply: (s) => { s.areaDamageMul += 0.2; } }),
  colossus: T({ id: 'colossus', name: 'Colossus', icon: '🛡', desc: '+25 armor, +10% max HP', apply: (s) => { s.armor += 25; s.maxHpMul *= 1.1; } }),
  arcaneWard: T({ id: 'arcaneWard', name: 'Arcane Ward', icon: '🔮', desc: '+20 armor, +15% max HP', apply: (s) => { s.armor += 20; s.maxHpMul *= 1.15; } }),
  momentum: T({ id: 'momentum', name: 'Momentum', icon: '➶', desc: 'Leap & movement skills recharge 30% faster', apply: (s) => { s.leapCooldownMul *= 0.7; } }),
  fleetFooted: T({ id: 'fleetFooted', name: 'Fleet-Footed', icon: '👟', desc: '+10% move speed, movement skills recharge 25% faster', apply: (s) => { s.moveSpeedMul += 0.1; s.leapCooldownMul *= 0.75; } }),
  cryomancy: T({ id: 'cryomancy', name: 'Cryomancy', icon: '❄', desc: 'Conditions you inflict last 40% longer', apply: (s) => { s.conditionDurationMul += 0.4; } }),

  // Conditions / tempo
  pyromaniac: T({ id: 'pyromaniac', name: 'Pyromaniac', icon: '🔥', desc: 'Burning deals +50% damage; conditions last 25% longer', apply: (s) => { s.burnDamageMul += 0.5; s.conditionDurationMul += 0.25; } }),
  emberSoul: T({ id: 'emberSoul', name: 'Ember Soul', icon: '🔥', desc: 'Burning deals +60% damage', apply: (s) => { s.burnDamageMul += 0.6; } }),
  bloodlust: T({ id: 'bloodlust', name: 'Bloodlust', icon: '🩸', desc: '+6% lifesteal', apply: (s) => { s.lifesteal += 0.06; } }),
  predator: T({ id: 'predator', name: 'Predator', icon: '🐺', desc: '+8% crit chance, +25% crit damage', apply: (s) => { s.critChance += 0.08; s.critMul += 0.25; } }),
  tempo: T({ id: 'tempo', name: 'Battle Tempo', icon: '⏩', desc: 'Cast times 20% shorter', apply: (s) => { s.castTimeMul *= 0.8; } }),
  quickening: T({ id: 'quickening', name: 'Quickening', icon: '⏩', desc: 'Cast times 25% shorter', apply: (s) => { s.castTimeMul *= 0.75; } }),
  survivalist: T({ id: 'survivalist', name: 'Survivalist', icon: '🌿', desc: 'Buff skills recharge 25% faster; potions heal 25% more', apply: (s) => { s.utilityCooldownMul *= 0.75; s.healMul += 0.25; } }),

  // Combos
  fieldMarshal: T({ id: 'fieldMarshal', name: 'Field Marshal', icon: '🗺', desc: 'Your fields last 50% longer and are 25% wider', apply: (s) => { s.fieldDurationMul += 0.5; s.fieldRadiusMul += 0.25; } }),
  comboAdept: T({ id: 'comboAdept', name: 'Combo Adept', icon: '✳', desc: 'Combo effects are 50% stronger', apply: (s) => { s.comboPotency += 0.5; } }),
  executioner: T({ id: 'executioner', name: 'Executioner', icon: '💀', desc: '+25% damage to Burning, Chilled or Vulnerable enemies', apply: (s) => { s.dmgVsAfflicted += 0.25; } }),

  // Grandmaster
  warlord: T({ id: 'warlord', name: 'Warlord', icon: '💪', desc: 'Every combo also grants 2 Might', apply: (s) => { s.comboMight += 2; } }),
  undaunted: T({ id: 'undaunted', name: 'Undaunted', icon: '✚', desc: 'Every combo also heals 4% max HP', apply: (s) => { s.comboHealPct += 0.04; } }),
  berserker: T({ id: 'berserker', name: 'Berserker', icon: '😤', desc: '+15% damage, −10% max HP', apply: (s) => { s.damageMul += 0.15; s.maxHpMul *= 0.9; } }),
  deadeye: T({ id: 'deadeye', name: 'Deadeye', icon: '🏹', desc: '+15% damage', apply: (s) => { s.damageMul += 0.15; } }),
  elementalFury: T({ id: 'elementalFury', name: 'Elemental Fury', icon: '🌋', desc: '+15% damage', apply: (s) => { s.damageMul += 0.15; } }),
} satisfies Record<string, TraitDef>;

export const traitById = (id: string): TraitDef | undefined => (TRAITS as Record<string, TraitDef>)[id];

const L = TRAITS;

/** Per class: 4 tiers × 3 choices. */
export const TRAIT_TIERS: Record<string, { name: string; choices: TraitDef[] }[]> = {
  warrior: [
    { name: 'Adept', choices: [L.brawler, L.colossus, L.momentum] },
    { name: 'Master', choices: [L.pyromaniac, L.bloodlust, L.tempo] },
    { name: 'Combos', choices: [L.fieldMarshal, L.comboAdept, L.executioner] },
    { name: 'Grandmaster', choices: [L.warlord, L.undaunted, L.berserker] },
  ],
  ranger: [
    { name: 'Adept', choices: [L.marksman, L.fieldMarshal, L.fleetFooted] },
    { name: 'Master', choices: [L.pyromaniac, L.predator, L.tempo] },
    { name: 'Combos', choices: [L.comboAdept, L.executioner, L.survivalist] },
    { name: 'Grandmaster', choices: [L.warlord, L.undaunted, L.deadeye] },
  ],
  mage: [
    { name: 'Adept', choices: [L.pyromancy, L.marksman, L.cryomancy] },
    { name: 'Master', choices: [L.fieldMarshal, L.quickening, L.arcaneWard] },
    { name: 'Combos', choices: [L.comboAdept, L.executioner, L.emberSoul] },
    { name: 'Grandmaster', choices: [L.warlord, L.undaunted, L.elementalFury] },
  ],
};

/** Selected trait ids per tier (null = none). */
export type TraitPicks = (string | null)[];

export function applyTraits(s: PlayerStats, picks: TraitPicks) {
  for (const id of picks) if (id) traitById(id)?.apply(s);
}
