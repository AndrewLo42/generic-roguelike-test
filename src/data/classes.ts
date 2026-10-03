import { SKILL_LIBRARY as L, type SkillDef, type SkillKind } from './skills';
import type { PlayerStats } from '../combat/stats';

export interface ClassDef {
  id: string;
  name: string;
  role: string;
  icon: string;
  color: number; // player mesh color
  css: string; // UI accent
  description: string;
  baseHp: number;
  moveSpeedMul: number;
  /** Default skills on keys 1–5 (slot 1 auto-repeats while held). Players can re-slot from `pool`. */
  kit: SkillDef[];
  /** Every skill this class can slot (in any slot). */
  pool: SkillDef[];
  /** Always-on class trait, applied to stats. */
  passive?: { name: string; desc: string; apply: (s: PlayerStats) => void };
  /** KayKit Adventurers model (public/assets/kaykit/characters/<model>.glb) and which held items to show. */
  visual: ModelVisual;
}

export interface ModelVisual {
  model: string;
  scale: number;
  /** Meshes attached to hand slots that stay visible (all other hand-slot props are hidden). */
  keep: string[];
  /** Extra weapon cloned from another model and attached to handslot.r (skeletons have none). */
  weapon?: { from: string; mesh: string };
  idle: string;
  move: string;
}

export const CLASSES: ClassDef[] = [
  {
    id: 'warrior', name: 'Warrior', role: 'Melee', icon: '🛡', color: 0xc0463a, css: '#e05a5a',
    description: 'Tough frontliner. Leaps into packs and cleaves everything around it.',
    baseHp: 260, moveSpeedMul: 1,
    kit: [L.cleave, L.savageLeap, L.whirl, L.flameBrand, L.warhorn],
    pool: [L.cleave, L.heavyStrike, L.savageLeap, L.chargingStrike, L.whirl, L.earthshaker, L.flameBrand, L.banner, L.warhorn],
    visual: { model: 'Knight', scale: 0.8, keep: ['2H_Sword'], idle: '2H_Melee_Idle', move: 'Running_A' },
  },
  {
    id: 'ranger', name: 'Ranger', role: 'Ranged', icon: '🏹', color: 0x5f9e3a, css: '#9ccf5a',
    description: 'Fast and mobile. Kites from range and disengages when cornered.',
    baseHp: 200, moveSpeedMul: 1.1,
    kit: [L.longShot, L.volley, L.fireTrap, L.disengage, L.huntersCall],
    pool: [L.longShot, L.quickShot, L.volley, L.barrage, L.fireTrap, L.frostTrap, L.pointBlank, L.flare, L.disengage, L.huntersCall],
    visual: { model: 'Rogue_Hooded', scale: 0.8, keep: ['2H_Crossbow'], idle: 'Idle', move: 'Running_A' },
  },
  {
    id: 'mage', name: 'Mage', role: 'Caster', icon: '🔮', color: 0x5a6ee0, css: '#8fa0ff',
    description: 'Fragile, huge area damage. Long casts — position before you commit.',
    baseHp: 170, moveSpeedMul: 1,
    kit: [L.arcaneBolt, L.flameBurst, L.meteor, L.frostNova, L.blink],
    pool: [L.arcaneBolt, L.iceShard, L.flameBurst, L.meteor, L.frostNova, L.arcaneWell, L.arcaneBlast, L.sunfire, L.blink],
    visual: { model: 'Mage', scale: 0.8, keep: ['2H_Staff'], idle: 'Idle', move: 'Running_A' },
  },
  {
    id: 'rogue', name: 'Rogue', role: 'Assassin', icon: '🗡', color: 0x6a4a8a, css: '#b9a0ff',
    description: 'Strikes from the shadows. Poisons, smoke and stealth — hit from behind for huge damage.',
    baseHp: 210, moveSpeedMul: 1.08,
    kit: [L.twinStrikes, L.backstab, L.shadowstep, L.smokeBomb, L.deathBlossom],
    pool: [L.twinStrikes, L.backstab, L.crippleStrike, L.shadowstep, L.smokeBomb, L.shadowBurst, L.deathBlossom, L.fanOfKnives, L.vanish, L.adrenaline],
    passive: {
      name: 'Opportunist',
      desc: '+30% damage from behind; attacks from Stealth deal +50% more (Ambush).',
      apply: (s) => { s.backstabBonus += 0.3; s.ambushBonus += 0.5; },
    },
    visual: { model: 'Rogue', scale: 0.8, keep: ['Knife', 'Knife_Offhand'], idle: 'Idle', move: 'Running_A' },
  },
];

export const classById = (id: string) => CLASSES.find((c) => c.id === id);

/** Skill kinds the class can use (from its whole pool, since loadouts are swappable). */
export const kitKinds = (c: ClassDef): Set<SkillKind> => new Set(c.pool.map((s) => s.kind));

/** Resolve a saved loadout (skill ids) against the class pool, falling back to the default kit. */
export function resolveLoadout(c: ClassDef, ids: (string | null)[] | undefined): SkillDef[] {
  return c.kit.map((def, i) => c.pool.find((s) => s.id === ids?.[i]) ?? def);
}
