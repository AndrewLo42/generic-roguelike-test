import { maxEnduranceOf, type PlayerState } from '../systems/player';
import { cooldownOf } from '../systems/combat';
import type { SkillDef } from '../data/skills';
import { type ClassDef, WEAPON_SLOTS } from '../data/classes';
import type { WeaponDef } from '../data/weapons';
import { POTION_HEAL_PCT } from '../data/items';
import type { PlayerStats } from '../combat/stats';
import { skillTooltipHtml } from './skillInfo';
import { STATUS, type StatusId } from '../combat/status';
import { ELEMENT_CSS, ELEMENT_ICON } from '../data/combos';
import { type CombatWorld, findEnemy } from '../combat/world';

const $ = <T extends HTMLElement = HTMLDivElement>(sel: string) => document.querySelector<T>(sel)!;

const info = $('#info');
const endurance = $('#endurance > div');
const hpFill = $('#hp > div');
const hpText = $('#hp > span');
const banner = $('#banner');
const error = $('#error');
const castbar = $('#castbar');
const castName = $('#castbar > .name');
const castFill = $('#castbar .bar > div');
const targetFrame = $('#target');
const targetName = $('#target > .name');
const targetFill = $('#target .bar > div');
let bannerTimer: number | undefined;

let skillEls: { el: HTMLDivElement; cd: HTMLDivElement; text: HTMLDivElement }[] = [];
let potionEl: { el: HTMLDivElement; cd: HTMLDivElement; count: HTMLElement } | null = null;
let swapEl: { el: HTMLDivElement; cd: HTMLDivElement; icon: HTMLElement } | null = null;
const prompt = $('#prompt');

// ---- Skill bar tooltips: hover a slot for full details (updated live while shown) ----
const tip = $('#skill-tip');
type Hover = { kind: 'skill'; i: number } | { kind: 'swap' } | { kind: 'potion' } | null;
let hover: Hover = null;
let hoverEl: HTMLElement | null = null;
let barWeapon = '';
let lastStats: PlayerStats | null = null;

function hoverable(el: HTMLElement, h: Exclude<Hover, null>) {
  // A rebuilt bar (weapon swap) keeps the tooltip if the cursor is already resting on the new slot.
  if (el.isConnected && el.matches(':hover')) { hover = h; hoverEl = el; }
  el.addEventListener('mouseenter', () => { hover = h; hoverEl = el; });
  el.addEventListener('mouseleave', () => { if (hoverEl === el) { hover = null; hoverEl = null; tip.style.display = 'none'; } });
}

/** Show `html` above the hovered slot, kept inside the window. */
function showTip(html: string) {
  if (!hoverEl) return;
  if (tip.innerHTML !== html) tip.innerHTML = html;
  tip.style.display = 'block';
  const r = hoverEl.getBoundingClientRect();
  const half = tip.offsetWidth / 2;
  tip.style.left = `${Math.min(window.innerWidth - half - 8, Math.max(half + 8, r.left + r.width / 2))}px`;
  tip.style.bottom = `${window.innerHeight - r.top + 8}px`;
}
const feed = $('#loot-feed');

/** Rebuild the skill bar: weapon swap, weapon skills 1–5, utilities 6–8, potion on H. */
export function buildSkillBar(kit: SkillDef[], weaponName = '') {
  const bar = $('#skills');
  bar.innerHTML = '';
  barWeapon = weaponName;
  hover = null;
  hoverEl = null;
  tip.style.display = 'none';
  const se = document.createElement('div');
  se.className = 'skill swap';
  se.style.marginRight = '10px';
  se.innerHTML = '<span class="key">`</span><i></i><div class="cd"></div>';
  bar.appendChild(se);
  swapEl = { el: se, cd: se.querySelector<HTMLDivElement>('.cd')!, icon: se.querySelector('i')! };
  hoverable(se, { kind: 'swap' });
  skillEls = kit.map((s, i) => {
    const el = document.createElement('div');
    el.className = 'skill';
    if (i === WEAPON_SLOTS) el.style.marginLeft = '10px'; // utilities
    el.style.color = s.color;
    el.innerHTML = `<span class="key">${i + 1}</span>${s.icon}<div class="cd"></div><div class="cdtext"></div>`;
    bar.appendChild(el);
    hoverable(el, { kind: 'skill', i });
    return { el, cd: el.querySelector<HTMLDivElement>('.cd')!, text: el.querySelector<HTMLDivElement>('.cdtext')! };
  });
  const pe = document.createElement('div');
  pe.className = 'skill potion';
  pe.style.marginLeft = '10px';
  pe.innerHTML = `<span class="key">H</span>🧪<div class="cd"></div><b></b>`;
  bar.appendChild(pe);
  potionEl = { el: pe, cd: pe.querySelector<HTMLDivElement>('.cd')!, count: pe.querySelector('b')! };
  hoverable(pe, { kind: 'potion' });
}

/** Interaction hint above the skill bar (empty string hides it). */
export function setPrompt(html: string) {
  if (prompt.innerHTML !== html) prompt.innerHTML = html;
}

/** Bottom-right pickup log; entries fade after a few seconds. */
export function pushFeed(html: string) {
  const el = document.createElement('div');
  el.innerHTML = html;
  feed.appendChild(el);
  while (feed.children.length > 6) feed.firstElementChild!.remove();
  setTimeout(() => (el.style.opacity = '0'), 3500);
  setTimeout(() => el.remove(), 4200);
}

const buffsEl = $('#buffs');
const toast = $('#combo-toast');
let toastTimer: number | undefined;

/** Player boons with stack counts and a draining duration bar. Also drains combo events into a toast. */
export function updateBuffs(w: CombatWorld) {
  const html = (Object.keys(w.playerStatus) as StatusId[]).map((id) => {
    const st = w.playerStatus[id]!;
    const def = STATUS[id];
    return `<div class="buff" style="border-color:${def.color};color:${def.color}" title="${def.name}: ${def.describe(st.stacks)}">` +
      `${def.icon}${st.stacks > 1 ? `<b>${st.stacks}</b>` : ''}<i style="width:${Math.min(100, (st.t / 8) * 100)}%"></i></div>`;
  }).join('');
  if (buffsEl.innerHTML !== html) buffsEl.innerHTML = html;

  const last = w.comboEvents[w.comboEvents.length - 1];
  if (last) {
    toast.innerHTML = `<span style="color:${ELEMENT_CSS[last.element]}">${ELEMENT_ICON[last.element]} ${last.name}</span>`;
    toast.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (toast.style.opacity = '0'), 900);
  }
  w.comboEvents.length = 0;
}

/** Weapon-swap button: shows the other set's weapon and the swap cooldown. */
export function updateSwapSlot(other: WeaponDef | null, cd: number, cdMax: number) {
  if (!swapEl) return;
  const icon = other?.icon ?? '';
  if (swapEl.icon.textContent !== icon) swapEl.icon.textContent = icon;
  swapEl.cd.style.height = `${Math.min(1, cd / cdMax) * 100}%`;
  swapEl.el.style.opacity = other ? '1' : '0.35';
  if (hover?.kind === 'swap') {
    showTip(other
      ? `<div class="tt-head"><span class="tt-ic">${other.icon}</span><b>Swap to ${other.name}</b><kbd>\`</kbd><kbd>X</kbd></div>` +
        `<div class="tt-sub">Weapon swap · ${cdMax}s cd</div>` +
        `<div class="tt-desc">Replaces skills 1–5 with your ${other.name} loadout. Utilities (6–8) stay. Swapped-out skills keep recharging.</div>` +
        (cd > 0 ? `<div class="tt-cd">Recharging — ${cd.toFixed(1)}s</div>` : '')
      : `<div class="tt-head"><b>Weapon swap</b></div><div class="tt-desc">No swap weapon equipped. Open the inventory (P) and shift-click a weapon in your bag.</div>`);
  }
}

export function updatePotionSlot(count: number, cd: number, cdMax: number) {
  if (!potionEl) return;
  potionEl.count.textContent = String(count);
  potionEl.cd.style.height = `${cdMax > 0 ? Math.min(1, cd / cdMax) * 100 : 0}%`;
  potionEl.el.style.opacity = count > 0 ? '1' : '0.45';
  if (hover?.kind === 'potion') {
    const pct = Math.round(POTION_HEAL_PCT * (lastStats?.healMul ?? 1) * 100);
    showTip(
      `<div class="tt-head"><span class="tt-ic">🧪</span><b>Health Potion</b><kbd>H</kbd></div>` +
      `<div class="tt-sub">Consumable · ${cdMax}s cd · ${count} left</div>` +
      `<div class="tt-desc">Restores ${pct}% of your max HP.</div>` +
      (cd > 0 ? `<div class="tt-cd">Recharging — ${cd.toFixed(1)}s</div>` : ''),
    );
  }
}

export function updateHud(p: PlayerState, w: CombatWorld, cls: ClassDef, seed: number, floor: number, fps: number, drawCalls: number) {
  info.innerHTML =
    `<b style="color:${cls.css}">${cls.name}</b> · Floor <b>${floor}</b> · Seed <b>${seed}</b> · Enemies <b>${w.enemies.length}</b><br>` +
    `${fps.toFixed(0)} fps · ${drawCalls} draw calls<br><br>` +
    `<kbd>W</kbd>/<kbd>S</kbd> move · <kbd>A</kbd>/<kbd>D</kbd> strafe · <kbd>Q</kbd>/<kbd>E</kbd> turn (strafe with RMB)<br>` +
    `<kbd>Space</kbd> jump · <kbd>V</kbd>/<kbd>Shift</kbd> dodge · <kbd>H</kbd> potion<br>` +
    `<kbd>F</kbd> open chest · <kbd>P</kbd> inventory · <kbd>K</kbd> skills · <kbd>T</kbd> traits<br>` +
    `<kbd>1</kbd>–<kbd>5</kbd> weapon skills (hold 1 to auto-attack) · <kbd>6</kbd>–<kbd>8</kbd> utilities<br>` +
    `<kbd>\`</kbd>/<kbd>X</kbd> swap weapons<br>` +
    `<kbd>Tab</kbd>/click target · <kbd>C</kbd> nearest · <kbd>Esc</kbd> clear target<br>` +
    `Hold <kbd>RMB</kbd> steer camera · <kbd>Wheel</kbd> zoom<br>` +
    `<kbd>R</kbd> restart run · reach the blue portal to descend`;

  endurance.style.width = `${(p.endurance / maxEnduranceOf(p)) * 100}%`;
  hpFill.style.width = `${(w.hp / w.maxHp) * 100}%`;
  hpText.textContent = `${Math.ceil(w.hp)} / ${w.maxHp}`;

  w.kit.forEach((s, i) => {
    const cd = w.cooldowns[i];
    const ui = skillEls[i];
    if (!ui) return;
    const full = cooldownOf(s, p);
    ui.cd.style.height = full > 0 ? `${Math.min(1, cd / full) * 100}%` : '0%';
    ui.text.textContent = cd > 0 ? (cd >= 1 ? cd.toFixed(0) : cd.toFixed(1)) : '';
    ui.el.classList.toggle('casting', w.cast?.slot === i);
    if (hover?.kind === 'skill' && hover.i === i) {
      const group = i < WEAPON_SLOTS ? `${barWeapon || 'Weapon'} skill` : 'Utility';
      showTip(skillTooltipHtml(s, { key: String(i + 1), group, stats: p.stats, cooldown: full, remaining: cd }));
    }
  });
  lastStats = p.stats;

  const c = w.cast;
  castbar.style.display = c && c.skill.castTime > 0 ? 'block' : 'none';
  if (c && c.skill.castTime > 0) {
    castName.textContent = c.skill.name;
    castFill.style.width = `${(1 - c.remaining / c.skill.castTime) * 100}%`;
  }

  error.textContent = w.error?.text ?? '';

  const target = findEnemy(w, w.targetId);
  targetFrame.style.display = target ? 'block' : 'none';
  if (target) {
    targetName.textContent = `${target.def.name}${w.hardTargetId === target.id ? '' : ' (auto)'}`;
    targetFill.style.width = `${(target.hp / target.maxHp) * 100}%`;
  }
}

export function showBanner(text: string, ms = 1600) {
  banner.textContent = text;
  banner.style.opacity = '1';
  clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => (banner.style.opacity = '0'), ms);
}
