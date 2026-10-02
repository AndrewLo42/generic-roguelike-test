import { maxEnduranceOf, type PlayerState } from '../systems/player';
import { cooldownOf } from '../systems/combat';
import type { SkillDef } from '../data/skills';
import type { ClassDef } from '../data/classes';
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
const prompt = $('#prompt');
const feed = $('#loot-feed');

/** Rebuild the skill bar for a class kit (plus the potion slot on H). */
export function buildSkillBar(kit: SkillDef[]) {
  const bar = $('#skills');
  bar.innerHTML = '';
  skillEls = kit.map((s, i) => {
    const el = document.createElement('div');
    el.className = 'skill';
    el.title = s.name;
    el.style.color = s.color;
    el.innerHTML = `<span class="key">${i + 1}</span>${s.icon}<div class="cd"></div><div class="cdtext"></div>`;
    bar.appendChild(el);
    return { el, cd: el.querySelector<HTMLDivElement>('.cd')!, text: el.querySelector<HTMLDivElement>('.cdtext')! };
  });
  const pe = document.createElement('div');
  pe.className = 'skill potion';
  pe.title = 'Health Potion';
  pe.style.marginLeft = '10px';
  pe.innerHTML = `<span class="key">H</span>🧪<div class="cd"></div><b></b>`;
  bar.appendChild(pe);
  potionEl = { el: pe, cd: pe.querySelector<HTMLDivElement>('.cd')!, count: pe.querySelector('b')! };
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

export function updatePotionSlot(count: number, cd: number, cdMax: number) {
  if (!potionEl) return;
  potionEl.count.textContent = String(count);
  potionEl.cd.style.height = `${cdMax > 0 ? Math.min(1, cd / cdMax) * 100 : 0}%`;
  potionEl.el.style.opacity = count > 0 ? '1' : '0.45';
}

export function updateHud(p: PlayerState, w: CombatWorld, cls: ClassDef, seed: number, floor: number, fps: number, drawCalls: number) {
  info.innerHTML =
    `<b style="color:${cls.css}">${cls.name}</b> · Floor <b>${floor}</b> · Seed <b>${seed}</b> · Enemies <b>${w.enemies.length}</b><br>` +
    `${fps.toFixed(0)} fps · ${drawCalls} draw calls<br><br>` +
    `<kbd>W</kbd>/<kbd>S</kbd> move · <kbd>A</kbd>/<kbd>D</kbd> strafe · <kbd>Q</kbd>/<kbd>E</kbd> turn (strafe with RMB)<br>` +
    `<kbd>Space</kbd> jump · <kbd>V</kbd>/<kbd>Shift</kbd> dodge · <kbd>H</kbd> potion<br>` +
    `<kbd>F</kbd> open chest · <kbd>P</kbd> inventory · <kbd>K</kbd> skills · <kbd>T</kbd> traits<br>` +
    `<kbd>1</kbd>–<kbd>5</kbd> skills (hold 1 to auto-attack)<br>` +
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
  });

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
