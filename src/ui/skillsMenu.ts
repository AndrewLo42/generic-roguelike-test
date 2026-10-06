import { type ClassDef, WEAPON_SLOTS } from '../data/classes';
import type { SkillDef } from '../data/skills';
import type { WeaponDef } from '../data/weapons';
import { COMBOS, ELEMENT_CSS, ELEMENT_ICON, type FieldElement, type Finisher, FINISHER_ICON } from '../data/combos';
import { TRAIT_TIERS, type TraitPicks } from '../data/traits';
import { skillChips, skillStatLine } from './skillInfo';

export interface SkillsContext {
  cls: ClassDef;
  /** Active weapon set and the swap set (if any). */
  weapon: WeaponDef;
  swapWeapon: WeaponDef | null;
  /** Saved weapon-skill loadout (slots 1–5) for any of the class's weapons. */
  weaponLoadout(w: WeaponDef): SkillDef[];
  /** Utility loadout (slots 6–8). */
  utilities: SkillDef[];
  traits: TraitPicks;
}

export interface SkillsActions {
  setWeaponSlot(w: WeaponDef, slot: number, skillId: string): void;
  setUtilitySlot(slot: number, skillId: string): void;
  setTrait(tier: number, traitId: string | null): void;
}

const $ = (id: string) => document.getElementById(id)!;
// Each group (weapon slots, utility slots) has its own selected slot; clicking a card fills its group's.
let selWeapon = 1;
let selUtility = 0;
/** Which weapon's loadout is being edited (any class weapon — equipped or not). */
let editing: string | null = null;

const ELEMENTS: FieldElement[] = ['fire', 'ice', 'light', 'arcane', 'smoke'];
const FINISHERS: Finisher[] = ['projectile', 'blast', 'leap', 'whirl'];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function renderSkillsTab(c: SkillsContext, a: SkillsActions) {
  const rerender = () => renderSkillsTab(c, a);
  const w = c.cls.weapons.find((x) => x.id === editing) ?? c.weapon;
  editing = w.id;
  const weaponKit = c.weaponLoadout(w);

  // Weapon tabs: pick whose 1–5 loadout to edit.
  const tabs = $('weapon-tabs');
  tabs.innerHTML = '';
  for (const x of c.cls.weapons) {
    const b = document.createElement('button');
    b.className = x === w ? 'on' : '';
    const tag = x === c.weapon ? 'active' : x === c.swapWeapon ? 'swap' : 'not equipped';
    b.innerHTML = `${x.icon} ${x.name} <small>(${tag})</small>`;
    b.addEventListener('click', () => { editing = x.id; rerender(); });
    tabs.appendChild(b);
  }

  // Loadout row: 5 weapon slots, a gap, 3 utility slots.
  const row = $('loadout-row');
  row.innerHTML = '';
  const slot = (s: SkillDef, key: number, sel: boolean, onClick: () => void) => {
    const el = document.createElement('div');
    el.className = 'lslot' + (sel ? ' sel' : '');
    el.innerHTML = `<span class="k">${key}${key === 1 ? ' · auto' : ''}</span><span class="ic" style="color:${s.color}">${s.icon}</span>${s.name}`;
    el.addEventListener('click', onClick);
    row.appendChild(el);
  };
  weaponKit.forEach((s, i) => slot(s, i + 1, i === selWeapon, () => { selWeapon = i; rerender(); }));
  row.appendChild(Object.assign(document.createElement('div'), { className: 'lgap' }));
  c.utilities.forEach((s, i) => slot(s, WEAPON_SLOTS + i + 1, i === selUtility, () => { selUtility = i; rerender(); }));

  // Pool: the edited weapon's skills, then class utilities.
  const pool = $('skill-pool');
  pool.innerHTML = '';
  const header = (html: string) => {
    const h = document.createElement('div');
    h.className = 'pool-head';
    h.innerHTML = html;
    pool.appendChild(h);
  };
  const card = (s: SkillDef, loadout: SkillDef[], offset: number, pick: () => void) => {
    const at = loadout.findIndex((l) => l.id === s.id);
    const el = document.createElement('div');
    el.className = 'scard' + (at >= 0 ? ' equipped' : '');
    el.innerHTML =
      (at >= 0 ? `<span class="slotno">slot ${at + offset + 1}</span>` : '') +
      `<div class="top"><span class="ic" style="color:${s.color}">${s.icon}</span>${s.name}</div>` +
      `<div class="meta">${skillStatLine(s)}</div><div>${s.desc ?? ''}</div><div>${skillChips(s)}</div>`;
    el.addEventListener('click', pick);
    pool.appendChild(el);
  };
  header(`${w.icon} <b>${w.name}</b> skills <small>— slots 1–5 · click a slot, then a skill</small>`);
  for (const s of w.skills) card(s, weaponKit, 0, () => a.setWeaponSlot(w, selWeapon, s.id));
  header(`<b>Utility</b> skills <small>— slots 6–8 · shared by every weapon, kept when you swap</small>`);
  for (const s of c.cls.utilities) card(s, c.utilities, WEAPON_SLOTS, () => a.setUtilitySlot(selUtility, s.id));

  // Combo reference: fields × finishers, highlighting combos your current loadout can do.
  const bar = [...weaponKit, ...c.utilities];
  const fields = new Set(bar.filter((s) => s.field).map((s) => s.field!.element));
  const finishers = new Set(bar.filter((s) => s.finisher).map((s) => s.finisher!));
  let html = '<table><tr><th></th>' + FINISHERS.map((f) => `<th title="${cap(f)} finisher">${FINISHER_ICON[f]}</th>`).join('') + '</tr>';
  for (const el of ELEMENTS) {
    html += `<tr><th style="color:${ELEMENT_CSS[el]}" title="${cap(el)} field">${ELEMENT_ICON[el]}</th>`;
    for (const f of FINISHERS) {
      const combo = COMBOS[el][f];
      const yours = fields.has(el) && finishers.has(f);
      html += `<td class="${yours ? 'yours' : ''}" style="color:${ELEMENT_CSS[el]}" title="${combo.name}: ${combo.text}">${combo.name}</td>`;
    }
    html += '</tr>';
  }
  html += '</table><div class="legend">Rows: fields (🔥 fire ❄ ice ☀ light ✦ arcane ☁ smoke). Columns: finishers (➹ projectile 💥 blast ⤴ leap 🌀 whirl). ' +
    'Use a finisher inside a field — or shoot through one — to trigger the combo. <b>Bold</b> = possible with the loadout shown above. Hover for effects.</div>';
  $('combo-ref').innerHTML = html;
}

export function renderTraitsTab(c: SkillsContext, a: SkillsActions) {
  const root = $('trait-tiers');
  root.innerHTML = '';
  (TRAIT_TIERS[c.cls.id] ?? []).forEach((tier, ti) => {
    const row = document.createElement('div');
    row.className = 'tier';
    row.innerHTML = `<div class="tname">${tier.name}</div>`;
    for (const t of tier.choices) {
      const sel = c.traits[ti] === t.id;
      const el = document.createElement('div');
      el.className = 'tcard' + (sel ? ' sel' : '');
      el.innerHTML = `<div class="top">${t.icon} ${t.name}</div><div>${t.desc}</div>`;
      el.addEventListener('click', () => a.setTrait(ti, sel ? null : t.id));
      row.appendChild(el);
    }
    root.appendChild(row);
  });
}
