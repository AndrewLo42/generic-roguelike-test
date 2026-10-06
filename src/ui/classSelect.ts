import { CLASSES, type ClassDef } from '../data/classes';

const root = document.getElementById('class-select')!;
const sub = root.querySelector<HTMLDivElement>('.sub')!;
const cardsEl = document.getElementById('class-cards')!;

let onPick: ((c: ClassDef) => void) | null = null;

export const isClassSelectOpen = () => root.classList.contains('open');

// Cards are static, so build them once.
CLASSES.forEach((c, i) => {
  const card = document.createElement('div');
  card.className = 'card';
  card.style.setProperty('--c', c.css);
  card.style.borderColor = c.css;
  card.innerHTML =
    `<span class="hotkey">${i + 1}</span><div class="icon">${c.icon}</div>` +
    `<div class="name">${c.name}</div><div class="role">${c.role}</div>` +
    `<div class="desc">${c.description}</div>` +
    `<div class="meta">${c.baseHp} HP${c.moveSpeedMul !== 1 ? ` · +${Math.round((c.moveSpeedMul - 1) * 100)}% speed` : ''}</div>` +
    (c.passive ? `<div class="meta" title="${c.passive.desc}"><b>${c.passive.name}:</b> ${c.passive.desc}</div>` : '') +
    `<div class="meta">Weapons: ${c.weapons.map((w) => `${w.icon} ${w.name}`).join(' · ')}</div>` +
    `<div class="kit">${c.weapons[0].kit.map((s) => `<span title="${s.name}" style="color:${s.color}">${s.icon}</span>`).join('')}</div>`;
  card.addEventListener('click', () => chooseClass(i));
  cardsEl.appendChild(card);
});

/** @param subtitle  e.g. "You died on floor 4" */
export function openClassSelect(pick: (c: ClassDef) => void, subtitle = 'Click a class or press 1–4') {
  onPick = pick;
  sub.textContent = subtitle;
  root.classList.add('open');
}

export function chooseClass(i: number) {
  if (!onPick || !CLASSES[i]) return;
  const cb = onPick;
  onPick = null;
  root.classList.remove('open');
  cb(CLASSES[i]);
}
