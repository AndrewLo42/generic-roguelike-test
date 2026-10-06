import { SKILL_LIBRARY as L, type SkillDef } from './skills';

/**
 * Weapon types. The equipped weapon decides which weapon skills a class can slot (GW2-style);
 * the class's utility skills work with every weapon. Loadouts are remembered per class + weapon.
 */
export interface WeaponDef {
  id: string;
  name: string;
  icon: string;
  /** Item base names for drops of this type ("Keen Greatsword"). */
  baseNames: string[];
  /** Skills only available while this weapon is equipped. */
  skills: SkillDef[];
  /** Default loadout for slots 1–5 (may include class utilities). */
  kit: SkillDef[];
  /** Hand-slot props shown on the class model while this weapon is equipped. */
  keep: string[];
  /** Idle clip override (e.g. the 2H stance for greatswords). */
  idle?: string;
}

export const CLASS_WEAPONS: Record<string, WeaponDef[]> = {
  warrior: [
    {
      id: 'greatsword', name: 'Greatsword', icon: '⚔', baseNames: ['Greatsword', 'Claymore', 'Zweihänder'],
      skills: [L.cleave, L.heavyStrike, L.savageLeap, L.chargingStrike, L.whirl, L.earthshaker],
      kit: [L.cleave, L.savageLeap, L.whirl, L.flameBrand, L.warhorn],
      keep: ['2H_Sword'], idle: '2H_Melee_Idle',
    },
    {
      id: 'swordShield', name: 'Sword & Shield', icon: '🛡', baseNames: ['Sword & Shield', 'Blade & Buckler', 'Arming Sword & Kite Shield'],
      skills: [L.swordSlash, L.lunge, L.shieldBash, L.shieldThrow, L.shieldStance],
      kit: [L.swordSlash, L.lunge, L.shieldBash, L.flameBrand, L.shieldStance],
      keep: ['1H_Sword', 'Round_Shield'],
    },
  ],
  ranger: [
    {
      id: 'crossbow', name: 'Crossbow', icon: '🏹', baseNames: ['Crossbow', 'Arbalest', 'Repeater'],
      skills: [L.longShot, L.quickShot, L.volley, L.barrage, L.pointBlank],
      kit: [L.longShot, L.volley, L.fireTrap, L.disengage, L.huntersCall],
      keep: ['2H_Crossbow'],
    },
    {
      id: 'knives', name: 'Hunting Knives', icon: '🔪', baseNames: ['Hunting Knives', 'Skinning Knives', 'Twin Fangs'],
      skills: [L.huntSlash, L.pounce, L.crosscut, L.throwKnives, L.predatorStrike],
      kit: [L.huntSlash, L.pounce, L.crosscut, L.fireTrap, L.disengage],
      keep: ['Knife', 'Knife_Offhand'],
    },
  ],
  mage: [
    {
      id: 'staff', name: 'Staff', icon: '🪄', baseNames: ['Staff', 'Battlestaff', 'Spire'],
      skills: [L.arcaneBolt, L.iceShard, L.flameBurst, L.meteor, L.arcaneWell, L.sunfire],
      kit: [L.arcaneBolt, L.flameBurst, L.meteor, L.frostNova, L.blink],
      keep: ['2H_Staff'],
    },
    {
      id: 'wandTome', name: 'Wand & Tome', icon: '📖', baseNames: ['Wand & Tome', 'Scepter & Grimoire', 'Rod & Codex'],
      skills: [L.wandBolt, L.arcaneMissiles, L.witheringHex, L.searingRay, L.tomeWard],
      kit: [L.wandBolt, L.arcaneMissiles, L.searingRay, L.tomeWard, L.blink],
      keep: ['1H_Wand', 'Spellbook_open'],
    },
  ],
  rogue: [
    {
      id: 'daggers', name: 'Daggers', icon: '🗡', baseNames: ['Daggers', 'Twin Blades', 'Stilettos'],
      skills: [L.twinStrikes, L.backstab, L.crippleStrike, L.deathBlossom, L.shadowBurst],
      kit: [L.twinStrikes, L.backstab, L.shadowstep, L.smokeBomb, L.deathBlossom],
      keep: ['Knife', 'Knife_Offhand'],
    },
    {
      id: 'handCrossbow', name: 'Hand Crossbow', icon: '🎯', baseNames: ['Hand Crossbow', 'Pistol Crossbow', 'Stinger'],
      skills: [L.quickBolt, L.headshot, L.unload, L.blackPowder, L.tumbleShot],
      kit: [L.quickBolt, L.headshot, L.blackPowder, L.tumbleShot, L.vanish],
      keep: ['1H_Crossbow', 'Knife_Offhand'],
    },
  ],
};

export const weaponsFor = (classId: string): WeaponDef[] => CLASS_WEAPONS[classId] ?? CLASS_WEAPONS.warrior;

/** The weapon def for an id, falling back to the class's primary weapon. */
export const weaponFor = (classId: string, weaponId: string | null | undefined): WeaponDef => {
  const ws = weaponsFor(classId);
  return ws.find((w) => w.id === weaponId) ?? ws[0];
};
