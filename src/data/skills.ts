import type { FieldElement, Finisher } from './combos';
import type { StatusId } from '../combat/status';

/**
 * Skills are data: `kind` picks the behavior in systems/combat.ts, the rest are its parameters.
 *   cone       — instant melee arc in front of you
 *   projectile — `count` projectiles fanned by `spread`; the center one homes if `homing`
 *   groundAoe  — delayed circle on the target (or ahead of you if none in range)
 *   selfAoe    — instant circle around you
 *   leap       — scripted movement; mode 'target' (gap-closer), 'forward' or 'backward'; optional landing AoE
 *   buff       — apply boons to yourself
 * Any skill may also leave a combo `field`, act as a combo `finisher`, apply `statuses` to enemies
 * it hits, or grant `buffs` to you.
 */
export type SkillKind = 'cone' | 'projectile' | 'groundAoe' | 'selfAoe' | 'leap' | 'buff';
export type LeapMode = 'target' | 'forward' | 'backward' | 'behind';

export interface StatusApply {
  id: StatusId;
  stacks: number;
  duration: number;
}

export interface SkillDef {
  id: string;
  name: string;
  icon: string;
  color: string;
  kind: SkillKind;
  cooldown: number; // seconds
  castTime: number; // seconds; effect resolves when the cast completes
  range: number; // reach / max distance (leaps: travel distance for forward/backward)
  damage: number;
  requiresTarget: boolean;
  /** One-line description for the loadout screen. */
  desc?: string;
  radius?: number;
  arc?: number; // radians, for cones
  delay?: number; // groundAoe impact delay after cast
  speed?: number; // projectile speed
  count?: number; // projectiles per cast
  spread?: number; // radians between fanned projectiles
  homing?: boolean;
  leapMode?: LeapMode;
  leapDuration?: number;
  leapHeight?: number;
  /** Leave a combo field: at the impact point (groundAoe) or under you (everything else). */
  field?: { element: FieldElement; duration: number; radius: number };
  /** Extra damage multiplier (on top of the backstab stat) when this skill hits from behind. */
  behindBonus?: number;
  /** Combo finisher type. Leaps check on landing; blasts/whirls at you when the skill resolves. */
  finisher?: Finisher;
  /** Conditions applied to enemies this skill hits. */
  statuses?: StatusApply[];
  /** Boons applied to yourself when the skill resolves. */
  buffs?: StatusApply[];
  /** KayKit animation clip played when the skill is used. */
  anim?: string;
  /** Fraction of the clip where the "hit" lands; playback is sped up so it lines up with the cast end. */
  animImpact?: number;
  /** Play on the whole body even while moving (spins, leaps, dodges). Default: upper body when moving. */
  animFullBody?: boolean;
}

const S = (d: SkillDef) => d;

export const SKILL_LIBRARY = {
  // ---------- Warrior ----------
  cleave: S({ id: 'cleave', name: 'Cleave', icon: '⚔', color: '#c9a24a', kind: 'cone', cooldown: 0, castTime: 0.5,
    range: 3.2, arc: Math.PI * 0.65, damage: 16, requiresTarget: false, desc: 'Sweep the area in front of you.',
    anim: '2H_Melee_Attack_Slice', animImpact: 0.45 }),
  heavyStrike: S({ id: 'heavyStrike', name: 'Heavy Strike', icon: '🗡', color: '#d0b070', kind: 'cone', cooldown: 0, castTime: 0.8,
    range: 3.4, arc: Math.PI * 0.3, damage: 30, requiresTarget: false, desc: 'Slow, narrow, hard-hitting chop. Inflicts Vulnerability.',
    statuses: [{ id: 'vulnerability', stacks: 2, duration: 6 }],
    anim: '2H_Melee_Attack_Chop', animImpact: 0.5 }),
  savageLeap: S({ id: 'savageLeap', name: 'Savage Leap', icon: '➶', color: '#e05a5a', kind: 'leap', cooldown: 8, castTime: 0,
    range: 12, radius: 2.8, damage: 30, requiresTarget: true, leapMode: 'target', finisher: 'leap',
    desc: 'Leap to your target and slam the ground.',
    anim: '2H_Melee_Attack_Chop', animImpact: 0.5, animFullBody: true }),
  whirl: S({ id: 'whirl', name: 'Whirling Strike', icon: '🌀', color: '#d9a441', kind: 'selfAoe', cooldown: 6, castTime: 0.3,
    range: 0, radius: 3.6, damage: 32, requiresTarget: false, finisher: 'whirl', desc: 'Spin, hitting everything around you.',
    anim: '2H_Melee_Attack_Spin', animImpact: 0.35, animFullBody: true }),
  earthshaker: S({ id: 'earthshaker', name: 'Earthshaker', icon: '🔨', color: '#b07a4a', kind: 'cone', cooldown: 9, castTime: 0.7,
    range: 5.5, arc: Math.PI * 0.4, damage: 55, requiresTarget: false, finisher: 'blast', desc: 'Long overhead slam.',
    anim: '2H_Melee_Attack_Chop', animImpact: 0.5 }),
  flameBrand: S({ id: 'flameBrand', name: 'Flame Brand', icon: '🔥', color: '#ff7a2f', kind: 'groundAoe', cooldown: 10, castTime: 0.4,
    range: 6, radius: 3, delay: 0.25, damage: 20, requiresTarget: false, desc: 'Scorch the ground ahead, leaving a Fire field.',
    field: { element: 'fire', duration: 6, radius: 3 }, statuses: [{ id: 'burning', stacks: 2, duration: 4 }],
    anim: '2H_Melee_Attack_Chop', animImpact: 0.5 }),
  chargingStrike: S({ id: 'chargingStrike', name: 'Rush', icon: '💨', color: '#e0c060', kind: 'leap', cooldown: 7, castTime: 0,
    range: 9, radius: 2.4, damage: 18, requiresTarget: false, leapMode: 'forward', leapDuration: 0.3, leapHeight: 0.6,
    finisher: 'leap', desc: 'Charge forward and strike on arrival.',
    anim: 'Dodge_Forward', animImpact: 1, animFullBody: true }),
  banner: S({ id: 'banner', name: 'Battle Standard', icon: '🚩', color: '#ffe27a', kind: 'buff', cooldown: 18, castTime: 0.4,
    range: 0, damage: 0, requiresTarget: false, desc: 'Plant a Light field; gain Protection and Regeneration.',
    field: { element: 'light', duration: 6, radius: 3.5 }, buffs: [{ id: 'protection', stacks: 1, duration: 5 }, { id: 'regeneration', stacks: 1, duration: 6 }],
    anim: 'Use_Item', animImpact: 0.4 }),
  warhorn: S({ id: 'warhorn', name: 'Warhorn', icon: '📯', color: '#ff9a40', kind: 'buff', cooldown: 15, castTime: 0.2,
    range: 0, damage: 0, requiresTarget: false, desc: 'Gain Swiftness, 5 Might and Regeneration.',
    buffs: [{ id: 'swiftness', stacks: 1, duration: 6 }, { id: 'might', stacks: 5, duration: 8 }, { id: 'regeneration', stacks: 1, duration: 5 }],
    anim: 'Cheer', animImpact: 0.3 }),

  // Warrior · Sword & Shield
  swordSlash: S({ id: 'swordSlash', name: 'Sword Slash', icon: '⚔', color: '#d8dce6', kind: 'cone', cooldown: 0, castTime: 0.38,
    range: 3, arc: Math.PI * 0.55, damage: 12, requiresTarget: false, desc: 'Quick slash that inflicts Vulnerability.',
    statuses: [{ id: 'vulnerability', stacks: 1, duration: 5 }],
    anim: '1H_Melee_Attack_Slice_Diagonal', animImpact: 0.45 }),
  lunge: S({ id: 'lunge', name: 'Lunge', icon: '➶', color: '#9fe4ff', kind: 'leap', cooldown: 7, castTime: 0,
    range: 10, radius: 2.2, damage: 22, requiresTarget: true, leapMode: 'target', leapDuration: 0.3, leapHeight: 0.4, finisher: 'leap',
    desc: 'Lunge at your target, Chilling it.', statuses: [{ id: 'chill', stacks: 1, duration: 2.5 }],
    anim: '1H_Melee_Attack_Stab', animImpact: 0.5, animFullBody: true }),
  shieldBash: S({ id: 'shieldBash', name: 'Shield Bash', icon: '🛡', color: '#e0c060', kind: 'cone', cooldown: 8, castTime: 0.25,
    range: 3, arc: Math.PI * 0.5, damage: 20, requiresTarget: false, finisher: 'blast',
    desc: 'Bash with your shield, Blinding enemies in front of you.', statuses: [{ id: 'blind', stacks: 1, duration: 3 }],
    anim: 'Block_Attack', animImpact: 0.5 }),
  shieldThrow: S({ id: 'shieldThrow', name: 'Shield Throw', icon: '◍', color: '#c9a24a', kind: 'projectile', cooldown: 6, castTime: 0.35,
    range: 16, speed: 26, radius: 0.45, damage: 18, count: 1, homing: true, requiresTarget: false, finisher: 'projectile',
    desc: 'Hurl your shield; it inflicts 2 Vulnerability.', statuses: [{ id: 'vulnerability', stacks: 2, duration: 6 }],
    anim: 'Throw', animImpact: 0.5 }),
  shieldStance: S({ id: 'shieldStance', name: 'Shield Stance', icon: '⛨', color: '#ffe27a', kind: 'buff', cooldown: 14, castTime: 0,
    range: 0, damage: 0, requiresTarget: false, desc: 'Brace behind your shield: Protection and Regeneration.',
    buffs: [{ id: 'protection', stacks: 1, duration: 4 }, { id: 'regeneration', stacks: 1, duration: 4 }],
    anim: 'Block', animImpact: 0.3 }),

  // ---------- Ranger ----------
  longShot: S({ id: 'longShot', name: 'Long Shot', icon: '➹', color: '#9ccf5a', kind: 'projectile', cooldown: 0, castTime: 0.45,
    range: 26, speed: 34, radius: 0.3, damage: 13, count: 1, homing: true, requiresTarget: false, finisher: 'projectile',
    desc: 'Homing arrow.', anim: '2H_Ranged_Shoot', animImpact: 0.4 }),
  quickShot: S({ id: 'quickShot', name: 'Quick Shot', icon: '⇢', color: '#b8e07a', kind: 'projectile', cooldown: 0, castTime: 0.28,
    range: 18, speed: 38, radius: 0.25, damage: 8, count: 1, homing: true, requiresTarget: false, finisher: 'projectile',
    desc: 'Fast, weak arrows — great for triggering combos.', anim: '2H_Ranged_Shoot', animImpact: 0.4 }),
  volley: S({ id: 'volley', name: 'Volley', icon: '⋔', color: '#c9e07a', kind: 'projectile', cooldown: 5, castTime: 0.35,
    range: 20, speed: 30, radius: 0.3, damage: 15, count: 5, spread: 0.13, requiresTarget: false, finisher: 'projectile',
    desc: 'Fan of 5 arrows.', anim: '2H_Ranged_Shoot', animImpact: 0.4 }),
  barrage: S({ id: 'barrage', name: 'Barrage', icon: '☔', color: '#ff8a3d', kind: 'groundAoe', cooldown: 10, castTime: 0.5,
    range: 22, radius: 3.6, delay: 0.7, damage: 40, requiresTarget: false, desc: 'Rain arrows on an area.',
    anim: '2H_Ranged_Shoot', animImpact: 0.4 }),
  frostTrap: S({ id: 'frostTrap', name: 'Frost Trap', icon: '❄', color: '#7fd8ff', kind: 'groundAoe', cooldown: 12, castTime: 0.4,
    range: 18, radius: 3, delay: 0.5, damage: 15, requiresTarget: false, desc: 'Ice field that Chills enemies.',
    field: { element: 'ice', duration: 6, radius: 3 }, statuses: [{ id: 'chill', stacks: 1, duration: 3 }],
    anim: 'Throw', animImpact: 0.5 }),
  fireTrap: S({ id: 'fireTrap', name: 'Fire Trap', icon: '🔥', color: '#ff7a2f', kind: 'groundAoe', cooldown: 12, castTime: 0.4,
    range: 18, radius: 3, delay: 0.5, damage: 15, requiresTarget: false, desc: 'Fire field that Burns enemies.',
    field: { element: 'fire', duration: 6, radius: 3 }, statuses: [{ id: 'burning', stacks: 2, duration: 4 }],
    anim: 'Throw', animImpact: 0.5 }),
  pointBlank: S({ id: 'pointBlank', name: 'Point Blank Shot', icon: '💥', color: '#e0a060', kind: 'cone', cooldown: 8, castTime: 0.3,
    range: 4.5, arc: Math.PI * 0.5, damage: 28, requiresTarget: false, finisher: 'blast', desc: 'Close-range blast of arrows.',
    anim: '2H_Ranged_Shoot', animImpact: 0.4 }),
  disengage: S({ id: 'disengage', name: 'Disengage', icon: '↶', color: '#5ec8ff', kind: 'leap', cooldown: 8, castTime: 0,
    range: 8, damage: 0, requiresTarget: false, leapMode: 'backward', leapDuration: 0.3, leapHeight: 1.2, finisher: 'leap',
    desc: 'Hop away from your target and gain Regeneration.', buffs: [{ id: 'regeneration', stacks: 1, duration: 3 }], anim: 'Dodge_Backward', animImpact: 1, animFullBody: true }),
  flare: S({ id: 'flare', name: 'Sun Flare', icon: '☀', color: '#ffe27a', kind: 'groundAoe', cooldown: 12, castTime: 0.4,
    range: 20, radius: 3.2, delay: 0.5, damage: 22, requiresTarget: false, desc: 'Flare that leaves a Light field.',
    field: { element: 'light', duration: 6, radius: 3.2 }, statuses: [{ id: 'vulnerability', stacks: 1, duration: 4 }],
    anim: '2H_Ranged_Shoot', animImpact: 0.4 }),
  huntersCall: S({ id: 'huntersCall', name: "Hunter's Call", icon: '📯', color: '#ffe066', kind: 'buff', cooldown: 15, castTime: 0.2,
    range: 0, damage: 0, requiresTarget: false, desc: 'Gain Swiftness, 4 Might and Regeneration.',
    buffs: [{ id: 'swiftness', stacks: 1, duration: 8 }, { id: 'might', stacks: 4, duration: 8 }, { id: 'regeneration', stacks: 1, duration: 6 }],
    anim: 'Cheer', animImpact: 0.3 }),

  // Ranger · Hunting Knives
  huntSlash: S({ id: 'huntSlash', name: 'Hunting Slash', icon: '⚔', color: '#b8e07a', kind: 'cone', cooldown: 0, castTime: 0.34,
    range: 2.8, arc: Math.PI * 0.6, damage: 12, requiresTarget: false, desc: 'Fast dual-knife slashes.',
    anim: 'Dualwield_Melee_Attack_Slice', animImpact: 0.4 }),
  pounce: S({ id: 'pounce', name: 'Pounce', icon: '🐾', color: '#9ccf5a', kind: 'leap', cooldown: 7, castTime: 0,
    range: 11, radius: 2.2, damage: 20, requiresTarget: true, leapMode: 'target', finisher: 'leap',
    desc: 'Pounce on your target, inflicting 3 Vulnerability.', statuses: [{ id: 'vulnerability', stacks: 3, duration: 6 }],
    anim: 'Dualwield_Melee_Attack_Stab', animImpact: 0.45, animFullBody: true }),
  crosscut: S({ id: 'crosscut', name: 'Crosscut', icon: '🌀', color: '#d9e07a', kind: 'selfAoe', cooldown: 6, castTime: 0.25,
    range: 0, radius: 3, damage: 22, requiresTarget: false, finisher: 'whirl', desc: 'Spin with both knives — a whirl finisher.',
    anim: '2H_Melee_Attack_Spin', animImpact: 0.35, animFullBody: true }),
  throwKnives: S({ id: 'throwKnives', name: 'Throw Knives', icon: '🔪', color: '#7fd8ff', kind: 'projectile', cooldown: 5, castTime: 0.25,
    range: 14, speed: 30, radius: 0.25, damage: 9, count: 3, spread: 0.18, requiresTarget: false, finisher: 'projectile',
    desc: 'Throw 3 knives that Chill.', statuses: [{ id: 'chill', stacks: 1, duration: 1.5 }],
    anim: 'Throw', animImpact: 0.5 }),
  predatorStrike: S({ id: 'predatorStrike', name: "Predator's Strike", icon: '🗡', color: '#e0a060', kind: 'cone', cooldown: 9, castTime: 0.5,
    range: 3, arc: Math.PI * 0.3, damage: 38, requiresTarget: false, behindBonus: 0.3,
    desc: 'Heavy double stab. +30% damage from behind.',
    anim: 'Dualwield_Melee_Attack_Chop', animImpact: 0.45 }),

  // ---------- Mage ----------
  arcaneBolt: S({ id: 'arcaneBolt', name: 'Arcane Bolt', icon: '✦', color: '#5ec8ff', kind: 'projectile', cooldown: 0, castTime: 0.55,
    range: 22, speed: 24, radius: 0.35, damage: 18, count: 1, homing: true, requiresTarget: false, finisher: 'projectile',
    desc: 'Homing bolt.', anim: 'Spellcast_Shoot', animImpact: 0.45 }),
  iceShard: S({ id: 'iceShard', name: 'Ice Shard', icon: '❆', color: '#9fe4ff', kind: 'projectile', cooldown: 0, castTime: 0.6,
    range: 20, speed: 22, radius: 0.35, damage: 14, count: 1, homing: true, requiresTarget: false, finisher: 'projectile',
    statuses: [{ id: 'chill', stacks: 1, duration: 1.5 }], desc: 'Bolt that Chills.',
    anim: 'Spellcast_Shoot', animImpact: 0.45 }),
  flameBurst: S({ id: 'flameBurst', name: 'Flame Burst', icon: '🔥', color: '#ff6a3d', kind: 'groundAoe', cooldown: 4, castTime: 0.3,
    range: 18, radius: 2.6, delay: 0.35, damage: 32, requiresTarget: false, desc: 'Quick blast that Burns.',
    statuses: [{ id: 'burning', stacks: 1, duration: 4 }],
    anim: 'Spellcast_Shoot', animImpact: 0.45 }),
  meteor: S({ id: 'meteor', name: 'Meteor', icon: '☄', color: '#ff8a3d', kind: 'groundAoe', cooldown: 12, castTime: 0.8,
    range: 18, radius: 4.2, delay: 1.0, damage: 70, requiresTarget: false, desc: 'Huge impact that leaves a Fire field.',
    field: { element: 'fire', duration: 5, radius: 4 },
    anim: 'Spellcast_Long', animImpact: 0.55 }),
  frostNova: S({ id: 'frostNova', name: 'Frost Nova', icon: '❄', color: '#9fe4ff', kind: 'selfAoe', cooldown: 9, castTime: 0.2,
    range: 0, radius: 4.5, damage: 28, requiresTarget: false, finisher: 'blast', desc: 'Chill everything around you and gain Regeneration. Leaves an Ice field.',
    field: { element: 'ice', duration: 5, radius: 4 }, statuses: [{ id: 'chill', stacks: 1, duration: 3 }], buffs: [{ id: 'regeneration', stacks: 1, duration: 4 }],
    anim: 'Spellcast_Raise', animImpact: 0.5 }),
  arcaneWell: S({ id: 'arcaneWell', name: 'Arcane Well', icon: '◎', color: '#c77dff', kind: 'groundAoe', cooldown: 14, castTime: 0.4,
    range: 18, radius: 3.5, delay: 0.4, damage: 10, requiresTarget: false, desc: 'Arcane field that makes enemies Vulnerable.',
    field: { element: 'arcane', duration: 6, radius: 3.5 }, statuses: [{ id: 'vulnerability', stacks: 3, duration: 6 }],
    anim: 'Spellcast_Raise', animImpact: 0.5 }),
  arcaneBlast: S({ id: 'arcaneBlast', name: 'Arcane Blast', icon: '💥', color: '#c77dff', kind: 'selfAoe', cooldown: 7, castTime: 0.3,
    range: 0, radius: 3.2, damage: 24, requiresTarget: false, finisher: 'blast', desc: 'Short-range burst — a blast finisher.',
    anim: 'Spellcast_Raise', animImpact: 0.5 }),
  blink: S({ id: 'blink', name: 'Blink', icon: '✧', color: '#c77dff', kind: 'leap', cooldown: 10, castTime: 0,
    range: 9, damage: 0, requiresTarget: false, leapMode: 'forward', leapDuration: 0.12, leapHeight: 0, finisher: 'leap',
    desc: 'Teleport forward and gain Regeneration.', buffs: [{ id: 'regeneration', stacks: 1, duration: 3 }], anim: 'Dodge_Forward', animImpact: 1, animFullBody: true }),
  sunfire: S({ id: 'sunfire', name: 'Sunfire', icon: '☀', color: '#ffe27a', kind: 'groundAoe', cooldown: 12, castTime: 0.5,
    range: 18, radius: 3.5, delay: 0.6, damage: 30, requiresTarget: false, desc: 'Column of light that leaves a Light field and grants Regeneration.',
    field: { element: 'light', duration: 6, radius: 3.5 }, buffs: [{ id: 'regeneration', stacks: 1, duration: 5 }],
    anim: 'Spellcast_Long', animImpact: 0.55 }),

  // Mage · Wand & Tome
  wandBolt: S({ id: 'wandBolt', name: 'Wand Bolt', icon: '⁕', color: '#c77dff', kind: 'projectile', cooldown: 0, castTime: 0.35,
    range: 20, speed: 30, radius: 0.3, damage: 10, count: 1, homing: true, requiresTarget: false, finisher: 'projectile',
    desc: 'Rapid homing bolts — weaker than Arcane Bolt, but they trigger combos quickly.', anim: 'Spellcast_Shoot', animImpact: 0.45 }),
  arcaneMissiles: S({ id: 'arcaneMissiles', name: 'Arcane Missiles', icon: '✶', color: '#d8a0ff', kind: 'projectile', cooldown: 5, castTime: 0.4,
    range: 20, speed: 26, radius: 0.3, damage: 12, count: 3, spread: 0.1, homing: true, requiresTarget: false, finisher: 'projectile',
    desc: 'Three missiles that each inflict Vulnerability.', statuses: [{ id: 'vulnerability', stacks: 1, duration: 5 }],
    anim: 'Spellcast_Shoot', animImpact: 0.45 }),
  witheringHex: S({ id: 'witheringHex', name: 'Withering Hex', icon: '☠', color: '#9a7aff', kind: 'groundAoe', cooldown: 8, castTime: 0.3,
    range: 18, radius: 2.4, delay: 0.25, damage: 14, requiresTarget: false, desc: 'Curse an area: 4 Vulnerability and Chill.',
    statuses: [{ id: 'vulnerability', stacks: 4, duration: 6 }, { id: 'chill', stacks: 1, duration: 2 }],
    anim: 'Spellcast_Raise', animImpact: 0.5 }),
  searingRay: S({ id: 'searingRay', name: 'Searing Ray', icon: '⚡', color: '#ff8a3d', kind: 'cone', cooldown: 7, castTime: 0.45,
    range: 10, arc: Math.PI * 0.14, damage: 36, requiresTarget: false, desc: 'Narrow beam of fire that Burns everything in a line.',
    statuses: [{ id: 'burning', stacks: 2, duration: 4 }],
    anim: 'Spellcast_Long', animImpact: 0.55 }),
  tomeWard: S({ id: 'tomeWard', name: 'Tome of Warding', icon: '📖', color: '#ffe27a', kind: 'buff', cooldown: 16, castTime: 0.3,
    range: 0, damage: 0, requiresTarget: false, desc: 'Read a ward: a Light field under you, Protection and Regeneration.',
    field: { element: 'light', duration: 6, radius: 3.2 }, buffs: [{ id: 'protection', stacks: 1, duration: 4 }, { id: 'regeneration', stacks: 1, duration: 5 }],
    anim: 'Use_Item', animImpact: 0.4 }),

  // ---------- Rogue ----------
  twinStrikes: S({ id: 'twinStrikes', name: 'Twin Strikes', icon: '⚔', color: '#c0c8d8', kind: 'cone', cooldown: 0, castTime: 0.32,
    range: 2.7, arc: Math.PI * 0.6, damage: 10, requiresTarget: false, desc: 'Quick dual-dagger slashes that Poison.',
    statuses: [{ id: 'poison', stacks: 1, duration: 6 }],
    anim: 'Dualwield_Melee_Attack_Slice', animImpact: 0.4 }),
  backstab: S({ id: 'backstab', name: 'Backstab', icon: '🗡', color: '#e0a0ff', kind: 'cone', cooldown: 5, castTime: 0.35,
    range: 2.8, arc: Math.PI * 0.35, damage: 26, requiresTarget: false, behindBonus: 0.6,
    desc: 'Heavy stab. +60% damage from behind (stacks with the Rogue passive).',
    anim: 'Dualwield_Melee_Attack_Stab', animImpact: 0.45 }),
  shadowstep: S({ id: 'shadowstep', name: 'Shadowstep', icon: '👣', color: '#9a7aff', kind: 'leap', cooldown: 9, castTime: 0,
    range: 14, damage: 0, requiresTarget: true, leapMode: 'behind', leapDuration: 0.12, leapHeight: 0, finisher: 'leap',
    desc: 'Teleport behind your target and vanish for 1s (follow with Backstab). Gain Regeneration.',
    buffs: [{ id: 'stealth', stacks: 1, duration: 1 }, { id: 'regeneration', stacks: 1, duration: 3 }],
    anim: 'Dodge_Forward', animImpact: 1, animFullBody: true }),
  smokeBomb: S({ id: 'smokeBomb', name: 'Smoke Bomb', icon: '💣', color: '#a6a6c2', kind: 'selfAoe', cooldown: 12, castTime: 0.2,
    range: 0, radius: 3.2, damage: 6, requiresTarget: false,
    desc: 'Blind nearby enemies and leave a Smoke field. Blast or leap inside it to Stealth.',
    field: { element: 'smoke', duration: 5, radius: 3.5 }, statuses: [{ id: 'blind', stacks: 1, duration: 3 }],
    anim: 'Throw', animImpact: 0.5 }),
  deathBlossom: S({ id: 'deathBlossom', name: 'Death Blossom', icon: '🌀', color: '#8fd14f', kind: 'selfAoe', cooldown: 7, castTime: 0.3,
    range: 0, radius: 3.2, damage: 16, requiresTarget: false, finisher: 'whirl',
    desc: 'Spinning flurry that Poisons everything around you.', statuses: [{ id: 'poison', stacks: 3, duration: 6 }],
    anim: '2H_Melee_Attack_Spin', animImpact: 0.35, animFullBody: true }),
  fanOfKnives: S({ id: 'fanOfKnives', name: 'Fan of Knives', icon: '🔪', color: '#d0d0e0', kind: 'projectile', cooldown: 4, castTime: 0.25,
    range: 14, speed: 30, radius: 0.25, damage: 9, count: 3, spread: 0.22, requiresTarget: false, finisher: 'projectile',
    desc: 'Throw 3 poisoned knives.', statuses: [{ id: 'poison', stacks: 1, duration: 6 }],
    anim: 'Throw', animImpact: 0.5 }),
  shadowBurst: S({ id: 'shadowBurst', name: 'Shadow Burst', icon: '💥', color: '#9a7aff', kind: 'selfAoe', cooldown: 8, castTime: 0.2,
    range: 0, radius: 2.8, damage: 18, requiresTarget: false, finisher: 'blast',
    desc: 'Burst of shadow — a blast finisher. In smoke: Stealth.',
    anim: '1H_Melee_Attack_Slice_Horizontal', animImpact: 0.45 }),
  crippleStrike: S({ id: 'crippleStrike', name: 'Crippling Strike', icon: '🦵', color: '#7fd8ff', kind: 'cone', cooldown: 8, castTime: 0.3,
    range: 2.8, arc: Math.PI * 0.4, damage: 16, requiresTarget: false, desc: 'Hamstring: Chill and 2 Vulnerability.',
    statuses: [{ id: 'chill', stacks: 1, duration: 3 }, { id: 'vulnerability', stacks: 2, duration: 6 }],
    anim: 'Dualwield_Melee_Attack_Chop', animImpact: 0.45 }),
  vanish: S({ id: 'vanish', name: 'Vanish', icon: '👤', color: '#b9a0ff', kind: 'buff', cooldown: 20, castTime: 0,
    range: 0, damage: 0, requiresTarget: false, desc: 'Instantly Stealth (3s) with Swiftness and Regeneration.',
    buffs: [{ id: 'stealth', stacks: 1, duration: 3 }, { id: 'swiftness', stacks: 1, duration: 3 }, { id: 'regeneration', stacks: 1, duration: 3 }],
    anim: 'Dodge_Backward', animImpact: 1, animFullBody: true }),
  adrenaline: S({ id: 'adrenaline', name: 'Adrenaline Rush', icon: '⚡', color: '#ffe066', kind: 'buff', cooldown: 15, castTime: 0,
    range: 0, damage: 0, requiresTarget: false, desc: 'Gain 5 Might, Swiftness and Regeneration.',
    buffs: [{ id: 'might', stacks: 5, duration: 8 }, { id: 'swiftness', stacks: 1, duration: 5 }, { id: 'regeneration', stacks: 1, duration: 4 }],
    anim: 'Cheer', animImpact: 0.3 }),

  // Rogue · Hand Crossbow
  quickBolt: S({ id: 'quickBolt', name: 'Quick Bolt', icon: '➹', color: '#c0c8d8', kind: 'projectile', cooldown: 0, castTime: 0.3,
    range: 18, speed: 36, radius: 0.25, damage: 9, count: 1, homing: true, requiresTarget: false, finisher: 'projectile',
    desc: 'Fast bolt that inflicts Vulnerability.', statuses: [{ id: 'vulnerability', stacks: 1, duration: 4 }],
    anim: '1H_Ranged_Shoot', animImpact: 0.4 }),
  headshot: S({ id: 'headshot', name: 'Headshot', icon: '🎯', color: '#ff6b5e', kind: 'projectile', cooldown: 6, castTime: 0.5,
    range: 22, speed: 44, radius: 0.3, damage: 32, count: 1, homing: true, requiresTarget: false, finisher: 'projectile',
    desc: 'Heavy aimed bolt that Blinds. Fire it from Stealth for a big Ambush.', statuses: [{ id: 'blind', stacks: 1, duration: 2 }],
    anim: '1H_Ranged_Shoot', animImpact: 0.4 }),
  unload: S({ id: 'unload', name: 'Unload', icon: '⋔', color: '#d0d0e0', kind: 'projectile', cooldown: 6, castTime: 0.4,
    range: 16, speed: 38, radius: 0.25, damage: 7, count: 5, spread: 0.05, homing: true, requiresTarget: false, finisher: 'projectile',
    desc: 'Fire 5 bolts in a tight spread.', anim: '1H_Ranged_Shooting', animImpact: 0.3 }),
  blackPowder: S({ id: 'blackPowder', name: 'Black Powder', icon: '💣', color: '#a6a6c2', kind: 'groundAoe', cooldown: 14, castTime: 0.3,
    range: 16, radius: 3, delay: 0.3, damage: 8, requiresTarget: false,
    desc: 'Lob a powder charge: Blinds and leaves a Smoke field on the target. Shadowstep into it to Stealth.',
    field: { element: 'smoke', duration: 5, radius: 3 }, statuses: [{ id: 'blind', stacks: 1, duration: 3 }],
    anim: 'Throw', animImpact: 0.5 }),
  tumbleShot: S({ id: 'tumbleShot', name: 'Tumble', icon: '↶', color: '#9a7aff', kind: 'leap', cooldown: 8, castTime: 0,
    range: 7, damage: 0, requiresTarget: false, leapMode: 'backward', leapDuration: 0.3, leapHeight: 0.8, finisher: 'leap',
    desc: 'Tumble away from your target and gain Swiftness.', buffs: [{ id: 'swiftness', stacks: 1, duration: 3 }],
    anim: 'Dodge_Backward', animImpact: 1, animFullBody: true }),
} satisfies Record<string, SkillDef>;

export const skillById = (id: string): SkillDef | undefined => (SKILL_LIBRARY as Record<string, SkillDef>)[id];
