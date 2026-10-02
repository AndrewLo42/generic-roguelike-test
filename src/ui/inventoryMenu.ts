import {
  type AffixStat, AFFIXES, type GearItem, type Item, type ItemSlot, ITEM_RARITY_COLOR, POTION_HEAL_PCT,
  SLOTS, SLOT_ICON, SLOT_LABEL, affixLabel, affixTotals,
} from '../data/items';
import { type PlayerStats, armorFactor } from '../combat/stats';
import type { ClassDef } from '../data/classes';
import type { Inventory } from '../game/inventory';
import { type SkillsActions, type SkillsContext, renderSkillsTab, renderTraitsTab } from './skillsMenu';

export type PauseTab = 'inventory' | 'skills' | 'traits';

export interface PauseContext extends SkillsContext {
  inv: Inventory;
  stats: PlayerStats;
  cls: ClassDef;
  hp: number;
  maxHp: number;
  floor: number;
}

export interface InventoryActions extends SkillsActions {
  equip(bagIndex: number): void;
  unequip(slot: ItemSlot): void;
  discard(bagIndex: number): void;
  usePotion(): void;
  resume(): void;
  abandon(): void;
}

const root = document.getElementById('pause')!;
const statsEl = document.getElementById('char-stats')!;
const equipEl = document.getElementById('equip-slots')!;
const bagEl = document.getElementById('bag-grid')!;
const detailsEl = document.getElementById('item-details')!;

let getCtx: (() => PauseContext) | null = null;
let actions: InventoryActions | null = null;
let tab: PauseTab = 'inventory';

export const isPauseOpen = () => root.classList.contains('open');
export const currentPauseTab = () => tab;

root.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) =>
  b.addEventListener('click', () => setPauseTab(b.dataset.tab as PauseTab)));

export function setPauseTab(t: PauseTab) {
  tab = t;
  root.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
  for (const name of ['inventory', 'skills', 'traits'] as PauseTab[]) {
    (document.getElementById(`tab-${name}`)!).hidden = name !== t;
  }
  renderPause();
}

document.getElementById('resume-btn')!.addEventListener('click', () => actions?.resume());
document.getElementById('abandon-btn')!.addEventListener('click', () => actions?.abandon());

export function openPause(ctx: () => PauseContext, a: InventoryActions, startTab: PauseTab = 'inventory') {
  getCtx = ctx;
  actions = a;
  root.classList.add('open');
  setPauseTab(startTab);
}

export function closePause() {
  root.classList.remove('open');
}

/** Re-render everything from current state (call after any inventory change). */
export function renderPause() {
  if (!getCtx || !isPauseOpen()) return;
  const c = getCtx();
  if (tab === 'skills') return renderSkillsTab(c, actions!);
  if (tab === 'traits') return renderTraitsTab(c, actions!);
  renderStats(c);
  renderEquipment(c);
  renderBag(c);
}

// ---------- panels ----------

function renderStats(c: PauseContext) {
  const s = c.stats;
  const rows: [string, string][] = [
    ['Class', `<span style="color:${c.cls.css}">${c.cls.name}</span>`],
    ['Floor', String(c.floor)],
    ['Health', `${Math.ceil(c.hp)} / ${c.maxHp}`],
    ['Armor', `${s.armor} <small>(−${Math.round((1 - armorFactor(s)) * 100)}% dmg taken)</small>`],
    ['Damage', `+${Math.round((s.damageMul - 1) * 100)}%`],
    ['Crit chance', `${Math.round(s.critChance * 100)}%`],
    ['Crit damage', `×${s.critMul.toFixed(2)}`],
    ['Cooldowns', `−${Math.round((1 - s.cooldownMul) * 100)}%`],
    ['Move speed', `${Math.round(s.moveSpeedMul * 100)}%`],
    ['Endurance regen', `${Math.round(s.enduranceRegenMul * 100)}%`],
    ['Lifesteal', `${Math.round(s.lifesteal * 100)}%`],
  ];
  statsEl.innerHTML = rows.map(([k, v]) => `<div class="stat-row"><span>${k}</span><b>${v}</b></div>`).join('');
}

function slotEl(item: Item | null, placeholder?: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'islot' + (item ? '' : ' empty');
  if (item) {
    el.style.borderColor = ITEM_RARITY_COLOR[item.rarity];
    el.innerHTML = item.icon + (item.kind === 'potion' ? `<b>${item.count}</b>` : '');
  } else if (placeholder) {
    el.innerHTML = `<span class="ph">${placeholder}</span>`;
  }
  return el;
}

function renderEquipment(c: PauseContext) {
  equipEl.innerHTML = '';
  for (const slot of SLOTS) {
    const item = c.inv.equipped[slot];
    const wrap = document.createElement('div');
    wrap.className = 'equip-row';
    const el = slotEl(item, SLOT_ICON[slot]);
    el.title = item ? 'Click to unequip' : SLOT_LABEL[slot];
    if (item) el.addEventListener('click', () => actions?.unequip(slot));
    el.addEventListener('mouseenter', () => showDetails(c, item, true));
    wrap.appendChild(el);
    const name = document.createElement('span');
    name.innerHTML = item ? `<span style="color:${ITEM_RARITY_COLOR[item.rarity]}">${item.name}</span>` : `<i>${SLOT_LABEL[slot]}</i>`;
    wrap.appendChild(name);
    equipEl.appendChild(wrap);
  }
}

function renderBag(c: PauseContext) {
  bagEl.innerHTML = '';
  c.inv.bag.forEach((item, i) => {
    const el = slotEl(item);
    if (item) {
      el.addEventListener('click', () => (item.kind === 'gear' ? actions?.equip(i) : actions?.usePotion()));
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); actions?.discard(i); });
      el.addEventListener('mouseenter', () => showDetails(c, item, false));
    }
    bagEl.appendChild(el);
  });
}

// ---------- details / comparison ----------

function showDetails(c: PauseContext, item: Item | null, isEquipped: boolean) {
  if (!item) {
    detailsEl.innerHTML = '<div class="muted">Empty slot</div>';
    return;
  }
  const color = ITEM_RARITY_COLOR[item.rarity];
  if (item.kind === 'potion') {
    detailsEl.innerHTML =
      `<div class="d-name" style="color:#ff8a80">${item.icon} ${item.name}</div>` +
      `<div class="d-meta">Consumable · ×${item.count}</div>` +
      `<div class="d-line">Restores ${Math.round(POTION_HEAL_PCT * c.stats.healMul * 100)}% max HP (${Math.round(c.maxHp * POTION_HEAL_PCT * c.stats.healMul)})</div>` +
      `<div class="d-hint">Click or press H to drink · right-click to discard</div>`;
    return;
  }
  const g: GearItem = item;
  const lines = g.affixes.map((a, i) => `<div class="d-line${i < implicitCount(g) ? ' implicit' : ''}">${affixLabel(a)}</div>`).join('');
  let compare = '';
  if (!isEquipped) {
    const current = c.inv.equipped[g.slot];
    compare = `<div class="d-sub">${current ? `vs. equipped <span style="color:${ITEM_RARITY_COLOR[current.rarity]}">${current.name}</span>` : 'Slot is empty'}</div>`;
    compare += diffLines(affixTotals(g), affixTotals(current));
  }
  detailsEl.innerHTML =
    `<div class="d-name" style="color:${color}">${g.icon} ${g.name}</div>` +
    `<div class="d-meta">${cap(g.rarity)} ${SLOT_LABEL[g.slot]} · Level ${g.level}</div>` +
    lines + compare +
    `<div class="d-hint">${isEquipped ? 'Click to unequip' : 'Click to equip · right-click to discard'}</div>`;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Implicit affixes (from the base type) come first: 1 for weapons/head/chest/boots pairs, 0 for trinkets. */
function implicitCount(g: GearItem) {
  return g.slot === 'weapon' ? 1 : g.slot === 'trinket' ? 0 : 2;
}

function diffLines(next: Partial<Record<AffixStat, number>>, cur: Partial<Record<AffixStat, number>>) {
  const stats = new Set([...Object.keys(next), ...Object.keys(cur)] as AffixStat[]);
  const out: string[] = [];
  for (const stat of stats) {
    const d = (next[stat] ?? 0) - (cur[stat] ?? 0);
    if (!d) continue;
    const text = AFFIXES[stat].label(Math.abs(d)).replace(/^[+−]/, '');
    // Lower cooldowns are good, so the sign reads naturally either way.
    out.push(`<div class="d-line ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${text}</div>`);
  }
  return out.length ? out.join('') : '<div class="d-line muted">No stat change</div>';
}
