import type { ModelVisual } from './classes';

/**
 * cone         — frontal cleave in front of the enemy
 * selfCircle   — AoE slam centered on the enemy
 * targetCircle — ground AoE dropped where the player stood when the cast began
 */
export type AttackShape = 'cone' | 'selfCircle' | 'targetCircle';

export interface EnemyDef {
  id: string;
  name: string;
  hp: number;
  speed: number;
  radius: number;
  height: number;
  color: number;
  aggroRange: number;
  /** Distance at which the enemy stops chasing and starts its attack. */
  attackRange: number;
  /** Chance to drop a gear item on death. */
  dropChance: number;
  attack: {
    shape: AttackShape;
    range: number; // cone length or circle radius
    arc?: number;
    windup: number; // telegraph duration — the dodge window
    recover: number;
    damage: number;
  };
  /** KayKit Skeletons model + animation names. */
  visual: ModelVisual & { attack: string; attackImpact: number };
}

export const ENEMIES: Record<string, EnemyDef> = {
  grunt: {
    id: 'grunt', name: 'Skeleton', hp: 60, speed: 4.2, radius: 0.45, height: 1.8, color: 0xd8d2c0,
    aggroRange: 13, attackRange: 2.4, dropChance: 0.14,
    attack: { shape: 'cone', range: 3.2, arc: Math.PI * 0.55, windup: 0.75, recover: 0.9, damage: 16 },
    visual: {
      model: 'Skeleton_Minion', scale: 0.8, keep: [], weapon: { from: 'Knight', mesh: '1H_Sword' },
      idle: 'Idle', move: 'Running_A', attack: '1H_Melee_Attack_Chop', attackImpact: 0.45,
    },
  },
  brute: {
    id: 'brute', name: 'Bone Brute', hp: 160, speed: 3, radius: 0.75, height: 2.5, color: 0x8a3b2e,
    aggroRange: 11, attackRange: 3, dropChance: 0.45,
    attack: { shape: 'selfCircle', range: 4.2, windup: 1.3, recover: 1.4, damage: 35 },
    visual: {
      model: 'Skeleton_Warrior', scale: 1.1, keep: [], weapon: { from: 'Knight', mesh: '2H_Sword' },
      idle: 'Idle_Combat', move: 'Walking_D_Skeletons', attack: '2H_Melee_Attack_Spin', attackImpact: 0.5,
    },
  },
  caster: {
    id: 'caster', name: 'Hexer', hp: 45, speed: 3.4, radius: 0.4, height: 1.9, color: 0x8a5cd6,
    aggroRange: 16, attackRange: 13, dropChance: 0.18,
    attack: { shape: 'targetCircle', range: 2.6, windup: 1.2, recover: 1.6, damage: 24 },
    visual: {
      model: 'Skeleton_Mage', scale: 0.85, keep: [], weapon: { from: 'Mage', mesh: '2H_Staff' },
      idle: 'Idle', move: 'Running_B', attack: 'Spellcast_Long', attackImpact: 0.6,
    },
  },
};
