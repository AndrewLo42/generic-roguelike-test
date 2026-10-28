import type { SkillDef } from '../data/skills';
import type { PlayerStats } from '../combat/stats';
import { ELEMENT_CSS, ELEMENT_ICON, FINISHER_ICON } from '../data/combos';
import { STATUS } from '../combat/status';

/** Shared skill formatting for the Skills tab cards and the HUD tooltips. */

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const secs = (v: number) => `${+v.toFixed(2)}s`;

/** Field / finisher / status chips. */
export function skillChips(s: SkillDef) {
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

/**
 * "30 dmg · 0.8s cast · 9s cd". With `cast`/`cooldown` overrides (effective values after stats),
 * changed numbers show the base struck through.
 */
export function skillStatLine(s: SkillDef, eff?: { cast: number; cooldown: number }) {
  const show = (base: number, now: number | undefined, unit: string, none: string) => {
    if (!base) return none;
    if (now === undefined || Math.abs(now - base) < 0.05) return `${secs(base)} ${unit}`;
    return `<s>${secs(base)}</s> <b class="better">${secs(now)}</b> ${unit}`;
  };
  const parts: string[] = [];
  if (s.damage) parts.push(`${s.damage}${s.count && s.count > 1 ? `×${s.count}` : ''} dmg`);
  parts.push(show(s.castTime, eff?.cast, 'cast', 'instant'));
  parts.push(show(s.cooldown, eff?.cooldown, 'cd', 'no cd'));
  return parts.join(' · ');
}

const KIND_LABEL: Record<SkillDef['kind'], string> = {
  cone: 'Melee arc', projectile: 'Projectile', groundAoe: 'Ground area', selfAoe: 'Area around you', leap: 'Movement', buff: 'Self buff',
};

/** Rich tooltip body for a skill on the HUD bar. */
export function skillTooltipHtml(
  s: SkillDef,
  o: { key: string; group: string; stats: PlayerStats; cooldown: number; remaining: number },
) {
  const range = s.kind === 'buff' || s.kind === 'selfAoe' ? (s.radius ? `${s.radius}m radius` : '') : `${s.range}m range`;
  return (
    `<div class="tt-head"><span class="tt-ic" style="color:${s.color}">${s.icon}</span><b>${s.name}</b><kbd>${o.key}</kbd></div>` +
    `<div class="tt-sub">${o.group} · ${KIND_LABEL[s.kind]}${range ? ` · ${range}` : ''}${s.requiresTarget ? ' · needs a target' : ''}</div>` +
    `<div class="tt-stats">${skillStatLine(s, { cast: s.castTime * o.stats.castTimeMul, cooldown: o.cooldown })}</div>` +
    (s.desc ? `<div class="tt-desc">${s.desc}</div>` : '') +
    (skillChips(s) ? `<div>${skillChips(s)}</div>` : '') +
    (o.remaining > 0 ? `<div class="tt-cd">Recharging — ${o.remaining.toFixed(1)}s</div>` : '')
  );
}
