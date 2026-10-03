import type { EnemyDef } from '../data/enemies';
import type { SkillDef } from '../data/skills';
import type { Item } from '../data/items';
import type { Shape } from './shapes';
import type { FieldElement, Finisher } from '../data/combos';
import type { StatusMap } from './status';

export type EnemyState = 'idle' | 'chase' | 'windup' | 'recover';

export interface Enemy {
  id: number;
  def: EnemyDef;
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  facing: number;
  hp: number;
  maxHp: number;
  damageMul: number;
  state: EnemyState;
  timer: number;
  hitFlash: number;
  room: number;
  /** Conditions on this enemy (burning, chill, vulnerability). */
  status: StatusMap;
}

/** A ground AoE that resolves after `duration`. Enemy attacks and player Meteor both use this. */
export interface Telegraph {
  id: number;
  shape: Shape;
  duration: number;
  elapsed: number;
  hostile: boolean; // true = hurts the player, false = hurts enemies
  damage: number;
  ownerId: number | null; // enemy id; cancelled if the owner dies
  /** Player skill that created it (friendly AoEs): applies its statuses/field on impact. */
  skill?: SkillDef;
  /** Cast from Stealth. */
  ambush?: boolean;
}

/** A lingering combo field on the ground (always the player's). */
export interface ComboField {
  id: number;
  x: number;
  z: number;
  r: number;
  element: FieldElement;
  remaining: number;
  duration: number;
  /** Accumulator for once-per-second field pulses. */
  pulse: number;
}

export interface Projectile {
  id: number;
  x: number;
  z: number;
  prevX: number;
  prevZ: number;
  dirX: number;
  dirZ: number;
  speed: number;
  damage: number;
  radius: number;
  life: number;
  targetId: number | null;
  /** Skill that fired it — for on-hit statuses and damage-family multipliers. */
  skill?: SkillDef;
  /** Set when the projectile passes through a combo field (projectile finisher). */
  combo?: FieldElement;
  /** Spawned by a whirl combo — doesn't trigger further combos. */
  comboBolt?: boolean;
  /** Fired from Stealth. */
  ambush?: boolean;
}

export type CombatEventKind = 'damage' | 'crit' | 'hurt' | 'heal' | 'evade' | 'info' | 'burn' | 'combo';

/** Fire-and-forget events the render layer turns into floating text. */
export interface CombatEvent {
  x: number;
  y: number;
  z: number;
  text: string;
  kind: CombatEventKind;
}

export interface Cast {
  skill: SkillDef;
  slot: number;
  remaining: number;
  targetId: number | null;
}

export interface GroundLoot {
  id: number;
  x: number;
  z: number;
  item: Item;
  /** Seconds before it can be auto-picked up (so it visibly pops out first). */
  delay: number;
}

export interface Chest {
  id: number;
  x: number;
  z: number;
  facing: number;
  opened: boolean;
  /** Gold chests hold an extra item and roll better rarities. */
  gold: boolean;
}

export interface CombatWorld {
  enemies: Enemy[];
  /** Enemies killed this tick; drained by the loot system. */
  kills: Enemy[];
  /** Skills that started casting since the render layer last looked (drives player animations). */
  skillEvents: SkillDef[];
  loot: GroundLoot[];
  chests: Chest[];
  projectiles: Projectile[];
  telegraphs: Telegraph[];
  fields: ComboField[];
  /** Boons on the player (might, regeneration, swiftness, protection). */
  playerStatus: StatusMap;
  /** Combos triggered since the render layer last looked (for a HUD toast). */
  comboEvents: { element: FieldElement; finisher: Finisher; name: string }[];
  /** Throttles projectile-combo announcements so a 5-arrow volley reads as one combo. */
  comboCooldown: number;
  events: CombatEvent[];
  nextId: number;
  /** Explicitly selected (Tab / click). Falls back to the soft target when invalid. */
  hardTargetId: number | null;
  /** The target skills will actually use this tick. */
  targetId: number | null;
  /** The class's skills on keys 1–5. */
  kit: SkillDef[];
  cooldowns: number[];
  cast: Cast | null;
  /** Skill pressed while busy (casting/dodging/leaping); fires when free if still within its window. */
  queued: { slot: number; t: number } | null;
  hp: number;
  maxHp: number;
  dead: boolean;
  /** Cheat-death charges left this run (Undying upgrade); carried across floors by main. */
  revives: number;
  error: { text: string; t: number } | null;
}

export function createCombatWorld(hp: number, maxHp: number, kit: SkillDef[]): CombatWorld {
  return {
    enemies: [], kills: [], skillEvents: [], loot: [], chests: [], projectiles: [], telegraphs: [], fields: [], playerStatus: {}, comboEvents: [], comboCooldown: 0, events: [], nextId: 1,
    hardTargetId: null, targetId: null,
    kit, cooldowns: kit.map(() => 0), cast: null, queued: null,
    hp: Math.min(hp, maxHp), maxHp, dead: false, revives: 0, error: null,
  };
}

export const findEnemy = (w: CombatWorld, id: number | null) =>
  id === null ? undefined : w.enemies.find((e) => e.id === id);
