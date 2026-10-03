/**
 * GW2-style combos: some skills leave an elemental FIELD on the ground; other skills are
 * FINISHERS. Using a finisher inside (or, for projectiles, through) a field triggers a combo.
 */
export type FieldElement = 'fire' | 'ice' | 'light' | 'arcane' | 'smoke';
export type Finisher = 'projectile' | 'blast' | 'leap' | 'whirl';

export const ELEMENT_COLOR: Record<FieldElement, number> = {
  fire: 0xff6a2a, ice: 0x6fd6ff, light: 0xffe27a, arcane: 0xb46bff, smoke: 0x8c8ca8,
};
export const ELEMENT_CSS: Record<FieldElement, string> = {
  fire: '#ff7a2f', ice: '#7fd8ff', light: '#ffe27a', arcane: '#c77dff', smoke: '#a6a6c2',
};
export const ELEMENT_ICON: Record<FieldElement, string> = { fire: '🔥', ice: '❄', light: '☀', arcane: '✦', smoke: '☁' };
export const FINISHER_ICON: Record<Finisher, string> = { projectile: '➹', blast: '💥', leap: '⤴', whirl: '🌀' };

export interface ComboDef {
  name: string;
  /** Player-facing summary (shown in the combo reference). */
  text: string;
}

/** The full combo table. Effects are implemented in systems/combat.ts (triggerCombo). */
export const COMBOS: Record<FieldElement, Record<Finisher, ComboDef>> = {
  fire: {
    projectile: { name: 'Burning Shot', text: 'Projectiles inflict 2 Burning' },
    blast: { name: 'Fire Blast', text: 'Gain 3 Might (8s)' },
    leap: { name: 'Ring of Fire', text: 'Burn enemies around where you land' },
    whirl: { name: 'Fire Whirl', text: 'Spray 6 burning bolts' },
  },
  ice: {
    projectile: { name: 'Frost Shot', text: 'Projectiles Chill' },
    blast: { name: 'Frost Armor', text: 'Gain Protection (5s)' },
    leap: { name: 'Frost Leap', text: 'Chill enemies around where you land' },
    whirl: { name: 'Ice Whirl', text: 'Spray 6 chilling shards' },
  },
  light: {
    projectile: { name: 'Cleansing Shot', text: 'Each hit heals you' },
    blast: { name: 'Healing Blast', text: 'Heal 12% max HP' },
    leap: { name: 'Radiant Leap', text: 'Gain Regeneration (6s)' },
    whirl: { name: 'Healing Whirl', text: 'Heal 8% max HP + Regeneration' },
  },
  arcane: {
    projectile: { name: 'Arcane Shot', text: 'Projectiles inflict 3 Vulnerability' },
    blast: { name: 'Arcane Shatter', text: 'Nearby enemies gain 5 Vulnerability' },
    leap: { name: 'Phase Leap', text: 'Gain Swiftness + 2 Might' },
    whirl: { name: 'Arcane Whirl', text: 'Spray 6 vulnerability bolts' },
  },
  smoke: {
    projectile: { name: 'Blinding Shot', text: 'Projectiles Blind (next enemy attack misses)' },
    blast: { name: 'Smoke Blast', text: 'Gain Stealth (3s)' },
    leap: { name: 'Shadow Leap', text: 'Gain Stealth (2s)' },
    whirl: { name: 'Smoke Whirl', text: 'Spray 6 blinding bolts' },
  },
};
