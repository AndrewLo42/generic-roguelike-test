import { type BoonDef, type BoonStacks, type Rarity, boonById } from '../data/boons';

export const RARITY_COLOR: Record<Rarity, string> = { common: '#b8c0cc', rare: '#4fa3ff', epic: '#c77dff' };

const root = document.getElementById('rewards')!;
const title = root.querySelector('h2')!;
const sub = root.querySelector<HTMLDivElement>('.sub')!;
const cardsEl = document.getElementById('reward-cards')!;
const boonsEl = document.getElementById('boons')!;

let onPick: ((b: BoonDef) => void) | null = null;
let current: BoonDef[] = [];

export const isRewardOpen = () => root.classList.contains('open');

export function closeRewards() {
  onPick = null;
  root.classList.remove('open');
}

/** Show the boon draft. `pick` is called once with the chosen boon. */
export function openRewards(offers: BoonDef[], owned: BoonStacks, cleared: boolean, floor: number, pick: (b: BoonDef) => void) {
  current = offers;
  onPick = pick;
  title.textContent = `Floor ${floor} complete`;
  sub.textContent = cleared
    ? 'Floor cleared — bonus choice! Pick a boon (click or 1–4)'
    : 'Pick a boon (click or 1–3). Clear every enemy for a 4th choice.';
  cardsEl.innerHTML = '';
  offers.forEach((b, i) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.setProperty('--c', RARITY_COLOR[b.rarity]);
    card.style.borderColor = RARITY_COLOR[b.rarity];
    const have = owned[b.id] ?? 0;
    card.innerHTML =
      `<span class="hotkey">${i + 1}</span><div class="icon">${b.icon}</div>` +
      `<div class="name">${b.name}</div><div class="rarity">${b.rarity}</div>` +
      `<div class="desc">${b.description}</div>` +
      (b.maxStacks > 1 ? `<div class="stacks">${have} → ${have + 1} / ${b.maxStacks}</div>` : '');
    card.addEventListener('click', () => choose(i));
    cardsEl.appendChild(card);
  });
  root.classList.add('open');
}

/** Pick by index (keyboard or click). Ignored if out of range or already closed. */
export function choose(i: number) {
  if (!onPick || i < 0 || i >= current.length) return;
  const cb = onPick;
  onPick = null;
  root.classList.remove('open');
  cb(current[i]);
}

export function renderOwnedBoons(owned: BoonStacks) {
  boonsEl.innerHTML = '';
  for (const [id, n] of Object.entries(owned)) {
    const b = boonById(id);
    const chip = document.createElement('div');
    chip.className = 'boon-chip';
    chip.style.borderColor = RARITY_COLOR[b.rarity];
    chip.title = `${b.name} — ${b.description}${n > 1 ? ` (×${n})` : ''}`;
    chip.innerHTML = `${b.icon}${n > 1 ? `<b>${n}</b>` : ''}`;
    boonsEl.appendChild(chip);
  }
}
