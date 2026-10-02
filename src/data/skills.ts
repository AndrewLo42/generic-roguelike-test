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
export type LeapMode = 'target' | 'forward' | 'backward';

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
} satisfies Record<string, SkillDef>;

export const skillById = (id: string): SkillDef | undefined => (SKILL_LIBRARY as Record<string, SkillDef>)[id];
