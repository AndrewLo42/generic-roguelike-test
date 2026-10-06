import type { ClassDef } from '../data/classes';
import type { SkillDef } from '../data/skills';
import type { WeaponDef } from '../data/weapons';
import { COMBOS, ELEMENT_CSS, ELEMENT_ICON, type FieldElement, type Finisher, FINISHER_ICON } from '../data/combos';
import { TRAIT_TIERS, type TraitPicks } from '../data/traits';
import { STATUS } from '../combat/status';

export interface SkillsContext {
  cls: ClassDef;
  /** Equipped weapon type — decides which weapon skills are in the pool. */
  weapon: WeaponDef;
  loadout: SkillDef[];
  traits: TraitPicks;
}

export interface SkillsActions {
  setSlot(slot: number, skillId: string): void;
  setTrait(tier: number, traitId: string | null): void;
}

const $ = (id: string) => document.getElementById(id)!;
let selectedSlot = 1;

const ELEMENTS: FieldElement[] = ['fire', 'ice', 'light', 'arcane', 'smoke'];
const FINISHERS: Finisher[] = ['projectile', 'blast', 'leap', 'whirl'];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function chips(s: SkillDef) {
  let out = '';
  if (s.field) {
    const c = ELEMENT_CSS[s.field.element];
    out += `<span class="chip" style="color:${c};border-color:${c}">${ELEMENT_ICON[s.field.element]} ${cap(s.field.element)} field</span>`;
  }
  if (s.finisher) out += `<span class="chip" style="color:#e8e6df;border-color:#ffffff55">${FINISHER_ICON[s.finisher]} ${cap(s.finisher)} finisher</span>`;
  for (const st of [...(s.statuses ?? []), ...(s.buffs ?? [])]) {
    const d = STATUS[st.id];
    out += `<span class="chip" style="color:${d.color};border-color:${d.color}">${d.icon} ${d.name}${st.stacks > 1 ? ` ×${st.stacks}` : ''}</span>`;
  }
  return out;
}

function stats(s: SkillDef) {
  const parts: string[] = [];
  if (s.damage) parts.push(`${s.damage}${s.count && s.count > 1 ? `×${s.count}` : ''} dmg`);
  parts.push(s.castTime ? `${s.castTime}s cast` : 'instant');
  parts.push(s.cooldown ? `${s.cooldown}s cd` : 'no cd');
  return parts.join(' · ');
}

export function renderSkillsTab(c: SkillsContext, a: SkillsActions) {
  // Loadout row
  const row = $('loadout-row');
  row.innerHTML = '';
  c.loadout.forEach((s, i) => {
    const el = document.createElement('div');
    el.className = 'lslot' + (i === selectedSlot ? ' sel' : '');
    el.innerHTML = `<span class="k">${i + 1}${i === 0 ? ' · auto' : ''}</span><span class="ic" style="color:${s.color}">${s.icon}</span>${s.name}`;
    el.addEventListener('click', () => { selectedSlot = i; renderSkillsTab(c, a); });
    row.appendChild(el);
  });

  // Pool: the equipped weapon's skills, then class utilities (usable with any weapon).
  const pool = $('skill-pool');
  pool.innerHTML = '';
  const others = c.cls.weapons.filter((w) => w !== c.weapon).map((w) => `${w.icon} ${w.name}`).join(', ');
  const header = (html: string) => {
    const h = document.createElement('div');
    h.className = 'pool-head';
    h.innerHTML = html;
    pool.appendChild(h);
  };
  for (const s of [...c.weapon.skills, ...c.cls.utilities]) {
    if (s === c.weapon.skills[0]) header(`${c.weapon.icon} <b>${c.weapon.name}</b> skills <small>— equip a ${others} in the Inventory tab for different ones</small>`);
    if (s === c.cls.utilities[0]) header(`<b>Utility</b> skills <small>— any weapon</small>`);
    const at = c.loadout.findIndex((l) => l.id === s.id);
    const el = document.createElement('div');
    el.className = 'scard' + (at >= 0 ? ' equipped' : '');
    el.innerHTML =
      (at >= 0 ? `<span class="slotno">slot ${at + 1}</span>` : '') +
      `<div class="top"><span class="ic" style="color:${s.color}">${s.icon}</span>${s.name}</div>` +
      `<div class="meta">${stats(s)}</div><div>${s.desc ?? ''}</div><div>${chips(s)}</div>`;
    el.addEventListener('click', () => a.setSlot(selectedSlot, s.id));
    pool.appendChild(el);
  }

  // Combo reference: fields × finishers, highlighting combos your current loadout can do.
  const fields = new Set(c.loadout.filter((s) => s.field).map((s) => s.field!.element));
  const finishers = new Set(c.loadout.filter((s) => s.finisher).map((s) => s.finisher!));
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
    'Use a finisher inside a field — or shoot through one — to trigger the combo. <b>Bold</b> = possible with your current skills. Hover for effects.</div>';
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
