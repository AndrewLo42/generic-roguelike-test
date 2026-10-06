import { SKILL_LIBRARY as L, type SkillDef, type SkillKind } from './skills';
import { type WeaponDef, weaponFor, weaponsFor } from './weapons';
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
  /** Weapon types the class can wield; the first is the starting/default one. Each brings its own skills. */
  weapons: WeaponDef[];
  /** Class skills usable with any weapon. */
  utilities: SkillDef[];
  /** Always-on class trait, applied to stats. */
  passive?: { name: string; desc: string; apply: (s: PlayerStats) => void };
  /** KayKit Adventurers model (public/assets/kaykit/characters/<model>.glb) and which held items to show. */
  visual: ModelVisual;
}

export interface ModelVisual {
  model: string;
  scale: number;
  /** Meshes attached to hand slots that stay visible (all other hand-slot props are hidden). For the player this comes from the weapon. */
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
    weapons: weaponsFor('warrior'),
    utilities: [L.flameBrand, L.banner, L.warhorn],
    visual: { model: 'Knight', scale: 0.8, keep: [], idle: 'Idle', move: 'Running_A' },
  },
  {
    id: 'ranger', name: 'Ranger', role: 'Ranged', icon: '🏹', color: 0x5f9e3a, css: '#9ccf5a',
    description: 'Fast and mobile. Kites from range and disengages when cornered.',
    baseHp: 200, moveSpeedMul: 1.1,
    weapons: weaponsFor('ranger'),
    utilities: [L.fireTrap, L.frostTrap, L.flare, L.disengage, L.huntersCall],
    visual: { model: 'Rogue_Hooded', scale: 0.8, keep: [], idle: 'Idle', move: 'Running_A' },
  },
  {
    id: 'mage', name: 'Mage', role: 'Caster', icon: '🔮', color: 0x5a6ee0, css: '#8fa0ff',
    description: 'Fragile, huge area damage. Long casts — position before you commit.',
    baseHp: 170, moveSpeedMul: 1,
    weapons: weaponsFor('mage'),
    utilities: [L.frostNova, L.arcaneBlast, L.blink],
    visual: { model: 'Mage', scale: 0.8, keep: [], idle: 'Idle', move: 'Running_A' },
  },
  {
    id: 'rogue', name: 'Rogue', role: 'Assassin', icon: '🗡', color: 0x6a4a8a, css: '#b9a0ff',
    description: 'Strikes from the shadows. Poisons, smoke and stealth — hit from behind for huge damage.',
    baseHp: 210, moveSpeedMul: 1.08,
    weapons: weaponsFor('rogue'),
    utilities: [L.shadowstep, L.smokeBomb, L.fanOfKnives, L.vanish, L.adrenaline],
    passive: {
      name: 'Opportunist',
      desc: '+30% damage from behind; attacks from Stealth deal +50% more (Ambush).',
      apply: (s) => { s.backstabBonus += 0.3; s.ambushBonus += 0.5; },
    },
    visual: { model: 'Rogue', scale: 0.8, keep: [], idle: 'Idle', move: 'Running_A' },
  },
];

export const classById = (id: string) => CLASSES.find((c) => c.id === id);

/** Every skill slottable with this weapon: its weapon skills, then the class utilities. */
export const poolFor = (c: ClassDef, w: WeaponDef): SkillDef[] => [...w.skills, ...c.utilities];

/** Skill kinds available with the current weapon (for boon filtering). Defaults to the primary weapon. */
export const kitKinds = (c: ClassDef, w: WeaponDef = c.weapons[0]): Set<SkillKind> => new Set(poolFor(c, w).map((s) => s.kind));

/** Saved-loadout key: per class + weapon. */
export const loadoutKey = (c: ClassDef, w: WeaponDef) => `${c.id}:${w.id}`;

/** Resolve a saved loadout (skill ids) against the weapon's pool, falling back to the weapon's default kit. */
export function resolveLoadout(c: ClassDef, w: WeaponDef, ids: (string | null)[] | undefined): SkillDef[] {
  const pool = poolFor(c, w);
  return w.kit.map((def, i) => pool.find((s) => s.id === ids?.[i]) ?? def);
}

export { weaponFor };
