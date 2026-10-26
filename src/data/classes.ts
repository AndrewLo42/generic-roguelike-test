import { SKILL_LIBRARY as L, type SkillDef, type SkillKind } from './skills';
import { type WeaponDef, weaponFor, weaponsFor } from './weapons';
import type { PlayerStats } from '../combat/stats';
import type { RigId } from '../render/rigs';

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
  /** Weapon types the class can wield; the first two are the default weapon sets. Each brings its own skills. */
  weapons: WeaponDef[];
  /** Class skills usable with any weapon (slots 6–8). */
  utilities: SkillDef[];
  /** Default utility loadout for slots 6–8. */
  utilityKit: SkillDef[];
  /** Always-on class trait, applied to stats. */
  passive?: { name: string; desc: string; apply: (s: PlayerStats) => void };
  /** KayKit Adventurers model (public/assets/kaykit/characters/<model>.glb) and which held items to show. */
  visual: ModelVisual;
}

export interface ModelVisual {
  model: string;
  /** Skeleton family (see render/rigs.ts). Default: KayKit. */
  rig?: RigId;
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
    utilityKit: [L.flameBrand, L.banner, L.warhorn],
    // Our Meshy-made Warrior (assets-src/meshy/warrior), self-rigged, with his Meshy-made weapons.
    visual: { model: 'Warrior', rig: 'meshy', scale: 1.35, keep: [], idle: 'Idle', move: 'Running_A' },
  },
  {
    id: 'ranger', name: 'Ranger', role: 'Ranged', icon: '🏹', color: 0x5f9e3a, css: '#9ccf5a',
    description: 'Fast and mobile. Kites from range and disengages when cornered.',
    baseHp: 200, moveSpeedMul: 1.1,
    weapons: weaponsFor('ranger'),
    utilities: [L.fireTrap, L.frostTrap, L.flare, L.disengage, L.huntersCall],
    utilityKit: [L.fireTrap, L.disengage, L.huntersCall],
    // The Rogue's body repainted as a ranger (render_sheet.py -> Meshy image-to-image -> project_paint.py);
    // KayKit crossbow and knives as stand-ins.
    visual: { model: 'Ranger', rig: 'meshy', scale: 1.35, keep: [], idle: 'Idle', move: 'Running_A' },
  },
  {
    id: 'mage', name: 'Mage', role: 'Caster', icon: '🔮', color: 0x5a6ee0, css: '#8fa0ff',
    description: 'Fragile, huge area damage. Long casts — position before you commit.',
    baseHp: 170, moveSpeedMul: 1,
    weapons: weaponsFor('mage'),
    utilities: [L.frostNova, L.arcaneBlast, L.blink],
    utilityKit: [L.frostNova, L.arcaneBlast, L.blink],
    // Our Meshy-made battle mage (assets-src/meshy/mage), self-rigged; KayKit staff/wand/book as stand-ins.
    visual: { model: 'BattleMage', rig: 'meshy', scale: 1.35, keep: [], idle: 'Idle', move: 'Running_A' },
  },
  {
    id: 'rogue', name: 'Rogue', role: 'Assassin', icon: '🗡', color: 0x6a4a8a, css: '#b9a0ff',
    description: 'Strikes from the shadows. Poisons, smoke and stealth — hit from behind for huge damage.',
    baseHp: 210, moveSpeedMul: 1.08,
    weapons: weaponsFor('rogue'),
    utilities: [L.shadowstep, L.smokeBomb, L.fanOfKnives, L.vanish, L.adrenaline],
    utilityKit: [L.shadowstep, L.smokeBomb, L.vanish],
    passive: {
      name: 'Opportunist',
      desc: '+30% damage from behind; attacks from Stealth deal +50% more (Ambush).',
      apply: (s) => { s.backstabBonus += 0.3; s.ambushBonus += 0.5; },
    },
    // Our Meshy-made hooded thief (assets-src/meshy/rogue), self-rigged; KayKit knives and hand crossbow as stand-ins.
    visual: { model: 'Thief', rig: 'meshy', scale: 1.35, keep: [], idle: 'Idle', move: 'Running_A' },
  },
];

export const classById = (id: string) => CLASSES.find((c) => c.id === id);

/** Skill bar layout: weapon skills on 1–5, utilities on 6–8. */
export const WEAPON_SLOTS = 5;
export const UTILITY_SLOTS = 3;

/** Skill kinds available with the given weapons + class utilities (for boon filtering). Defaults to the primary weapon. */
export const kitKinds = (c: ClassDef, weapons: WeaponDef[] = [c.weapons[0]]): Set<SkillKind> =>
  new Set([...weapons.flatMap((w) => w.skills), ...c.utilities].map((s) => s.kind));

/** Saved weapon-loadout key: per class + weapon. */
export const loadoutKey = (c: ClassDef, w: WeaponDef) => `${c.id}:${w.id}`;

/**
 * Resolve saved skill ids for a group of slots against what's allowed there. Invalid, missing or
 * duplicate ids fall back to unused defaults, then to any unused pool skill — never a duplicate.
 */
function resolveSlots(pool: SkillDef[], defaults: SkillDef[], ids: (string | null)[] | undefined): SkillDef[] {
  const out: (SkillDef | null)[] = defaults.map((_, i) => {
    const s = pool.find((p) => p.id === ids?.[i]);
    return s && !ids!.slice(0, i).includes(s.id) ? s : null;
  });
  const spare = [...defaults, ...pool].filter((s, i, a) => a.indexOf(s) === i && !out.includes(s));
  return out.map((s) => s ?? spare.shift()!);
}

export const resolveWeaponSkills = (w: WeaponDef, ids?: (string | null)[]) => resolveSlots(w.skills, w.kit, ids);
export const resolveUtilities = (c: ClassDef, ids?: (string | null)[]) => resolveSlots(c.utilities, c.utilityKit, ids);

export { weaponFor };
