/**
 * Run-long modifiers from class + boons. Stored as bonuses/multipliers on top of base values
 * (playerTuning, skill data, class HP) so debug tuning of the bases still works.
 */
export interface PlayerStats {
  baseHp: number; // from class
  damageMul: number;
  bonusMaxHp: number;
  maxHpMul: number;
  moveSpeedMul: number;
  enduranceRegenMul: number;
  bonusEndurance: number;
  cooldownMul: number;
  critChance: number;
  critMul: number;
  lifesteal: number; // fraction of damage dealt returned as HP
  healMul: number; // potion healing multiplier
  // Skill-kind modifiers
  extraProjectiles: number;
  groundAoeRadiusMul: number;
  groundAoeDamageMul: number;
  conesFullCircle: boolean;
  leapHeal: number;
  leapEndurance: number;
  riposteDamage: number; // AoE damage on a successful evade
  armor: number; // incoming damage × 100 / (100 + armor)
  // Trait modifiers (skill families, tempo, conditions, combos)
  coneDamageMul: number;
  projectileDamageMul: number;
  areaDamageMul: number; // groundAoe + selfAoe
  leapCooldownMul: number;
  utilityCooldownMul: number; // buff skills
  castTimeMul: number;
  burnDamageMul: number;
  conditionDurationMul: number;
  dmgVsAfflicted: number; // bonus vs Burning/Chilled/Vulnerable enemies
  fieldDurationMul: number;
  fieldRadiusMul: number;
  comboPotency: number;
  comboMight: number; // Might stacks granted per combo
  comboHealPct: number; // fraction of max HP healed per combo
}

export const BASE_STATS: Readonly<PlayerStats> = {
  baseHp: 200, damageMul: 1, bonusMaxHp: 0, maxHpMul: 1, moveSpeedMul: 1, enduranceRegenMul: 1, bonusEndurance: 0,
  cooldownMul: 1, critChance: 0.05, critMul: 1.75, lifesteal: 0, healMul: 1,
  extraProjectiles: 0, groundAoeRadiusMul: 1, groundAoeDamageMul: 1, conesFullCircle: false,
  leapHeal: 0, leapEndurance: 0, riposteDamage: 0, armor: 0,
  coneDamageMul: 1, projectileDamageMul: 1, areaDamageMul: 1, leapCooldownMul: 1, utilityCooldownMul: 1, castTimeMul: 1,
  burnDamageMul: 1, conditionDurationMul: 1, dmgVsAfflicted: 0,
  fieldDurationMul: 1, fieldRadiusMul: 1, comboPotency: 1, comboMight: 0, comboHealPct: 0,
};

/** Fraction of incoming damage that gets through, from armor (diminishing returns). */
export const armorFactor = (s: PlayerStats) => 100 / (100 + Math.max(0, s.armor));

export const maxHpOf = (s: PlayerStats) => Math.round((s.baseHp + s.bonusMaxHp) * s.maxHpMul);
