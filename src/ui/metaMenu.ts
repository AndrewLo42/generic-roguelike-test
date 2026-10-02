import { META_UPGRADES, rankOf, upgradeCost } from '../data/meta';
import { type MetaSave, buyRank, refundAll } from '../game/metaSave';

const $ = (id: string) => document.getElementById(id)!;

// ---------- Upgrades menu ----------

const upgRoot = $('upgrades');
const grid = $('upgrade-grid');
let upgSave: MetaSave | null = null;
let onUpgChange: (() => void) | null = null;
let onUpgClose: (() => void) | null = null;

export const isUpgradesOpen = () => upgRoot.classList.contains('open');

$('upg-done').addEventListener('click', () => closeUpgrades());
$('upg-refund').addEventListener('click', () => {
  if (!upgSave) return;
  refundAll(upgSave);
  onUpgChange?.();
  renderUpgrades();
});

/**
 * @param onChange  called after every purchase/refund (persist the save here)
 * @param onClose   called when the menu closes
 */
export function openUpgrades(save: MetaSave, onChange: () => void, onClose?: () => void) {
  upgSave = save;
  onUpgChange = onChange;
  onUpgClose = onClose ?? null;
  upgRoot.classList.add('open');
  renderUpgrades();
}

export function closeUpgrades() {
  if (!isUpgradesOpen()) return;
  upgRoot.classList.remove('open');
  const cb = onUpgClose;
  onUpgClose = null;
  cb?.();
}

function renderUpgrades() {
  const s = upgSave!;
  $('upg-shards').textContent = `💠 ${s.shards} Soul Shards`;
  $('upg-stats').textContent = `· ${s.stats.runs} runs · best floor ${s.stats.bestFloor}`;
  grid.innerHTML = '';
  for (const def of META_UPGRADES) {
    const r = rankOf(s.ranks, def.id);
    const maxed = r >= def.maxRank;
    const cost = maxed ? 0 : upgradeCost(def, r);
    const card = document.createElement('div');
    card.className = 'upg' + (maxed ? ' maxed' : '');
    const pips = Array.from({ length: def.maxRank }, (_, i) => `<i class="${i < r ? 'on' : ''}"></i>`).join('');
    const now = r > 0 ? def.effect(r) : 'Not learned';
    const next = maxed ? '' : ` → <b>${def.effect(r + 1)}</b>`;
    card.innerHTML =
      `<div class="upg-top"><span class="ic">${def.icon}</span>${def.name}<span class="muted" style="margin-left:auto;font-weight:400;font-size:12px">${r}/${def.maxRank}</span></div>` +
      `<div class="pips">${pips}</div>` +
      `<div class="eff">${now}${next}</div>`;
    const btn = document.createElement('button');
    btn.textContent = maxed ? 'Maxed' : `Upgrade · 💠 ${cost}`;
    btn.disabled = maxed || s.shards < cost;
    btn.addEventListener('click', () => {
      if (buyRank(s, def.id)) { onUpgChange?.(); renderUpgrades(); }
    });
    card.appendChild(btn);
    grid.appendChild(card);
  }
}

// ---------- Run summary ----------

const sumRoot = $('run-summary');
let onContinue: (() => void) | null = null;

export const isSummaryOpen = () => sumRoot.classList.contains('open');

$('summary-continue').addEventListener('click', () => continueFromSummary());

export function continueFromSummary() {
  if (!isSummaryOpen() || isUpgradesOpen()) return;
  sumRoot.classList.remove('open');
  const cb = onContinue;
  onContinue = null;
  cb?.();
}

export function showRunSummary(
  title: string, subtitle: string, breakdown: [string, number][], total: number,
  save: MetaSave, persist: () => void, next: () => void,
) {
  onContinue = next;
  sumRoot.querySelector('h2')!.textContent = title;
  sumRoot.querySelector<HTMLDivElement>('.sub')!.textContent = subtitle;
  $('summary-lines').innerHTML =
    breakdown.map(([k, v]) => `<div class="stat-row"><span>${k}</span><b>+${v}</b></div>`).join('') +
    `<div class="stat-row total"><span>Soul Shards earned</span><b>💠 ${total}</b></div>` +
    `<div class="stat-row"><span>Balance</span><b>💠 ${save.shards}</b></div>`;
  const upBtn = $('summary-upgrades');
  upBtn.onclick = () => openUpgrades(save, persist, () => {
    // Refresh the balance line after spending.
    const rows = $('summary-lines').querySelectorAll('.stat-row b');
    rows[rows.length - 1].textContent = `💠 ${save.shards}`;
  });
  sumRoot.classList.add('open');
}

/** Shard balance + "Upgrades" button under the class cards. */
export function renderClassMeta(save: MetaSave, persist: () => void) {
  const el = $('class-meta');
  el.innerHTML = `<span class="shards">💠 ${save.shards}</span>`;
  const btn = document.createElement('button');
  btn.textContent = 'Upgrades';
  btn.addEventListener('click', () => openUpgrades(save, persist, () => renderClassMeta(save, persist)));
  el.appendChild(btn);
}
