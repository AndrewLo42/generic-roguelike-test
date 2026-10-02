import type { Input } from '../core/input';
import type { SkillDef, StatusApply } from '../data/skills';
import { COMBOS, type FieldElement, type Finisher } from '../data/combos';
import { BURN_DPS_PER_STACK, REGEN_PCT, applyStatus, has, stacksOf, tickStatuses } from '../combat/status';
import type { Dungeon } from '../world/dungeon/generator';
import { hasLineOfSight, isWallAt } from '../world/collision';
import { type Shape, angleDiff, shapeHits } from '../combat/shapes';
import { type ComboField, type CombatWorld, type Enemy, findEnemy } from '../combat/world';
import { aggro } from './enemies';
import { type PlayerStats, armorFactor } from '../combat/stats';
import { isInvulnerable, maxEnduranceOf, playerTuning, type PlayerState } from './player';

/** Effective cooldown after boons, upgrades and traits. */
export function cooldownOf(skill: SkillDef, p: PlayerState) {
  const s = p.stats;
  let cd = skill.cooldown * s.cooldownMul;
  if (skill.kind === 'leap') cd *= s.leapCooldownMul;
  if (skill.kind === 'buff') cd *= s.utilityCooldownMul;
  return cd;
}

const SKILL_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];
const TARGET_MAX_RANGE = 30;
const SOFT_TARGET_RANGE = 22;
const SOFT_TARGET_CONE = (55 * Math.PI) / 180;
const SKILL_QUEUE_WINDOW = 0.6;

const dist = (p: PlayerState, e: Enemy) => Math.hypot(e.x - p.x, e.z - p.z);
const canSee = (d: Dungeon, p: PlayerState, e: Enemy) => hasLineOfSight(d, p.x, p.z, e.x, e.z);

function setError(w: CombatWorld, text: string) {
  w.error = { text, t: 1.2 };
}

// ---------- Targeting ----------

/** Tab cycles through visible enemies nearest-first. */
export function cycleTarget(w: CombatWorld, p: PlayerState, d: Dungeon) {
  const visible = w.enemies
    .filter((e) => dist(p, e) < TARGET_MAX_RANGE && canSee(d, p, e))
    .sort((a, b) => dist(p, a) - dist(p, b));
  if (!visible.length) { w.hardTargetId = null; return; }
  const i = visible.findIndex((e) => e.id === w.hardTargetId);
  w.hardTargetId = visible[(i + 1) % visible.length].id;
}

/** C: hard-target the nearest visible enemy regardless of camera direction. */
export function targetNearest(w: CombatWorld, p: PlayerState, d: Dungeon) {
  let best: Enemy | null = null;
  for (const e of w.enemies) {
    if (dist(p, e) < TARGET_MAX_RANGE && (!best || dist(p, e) < dist(p, best)) && canSee(d, p, e)) best = e;
  }
  w.hardTargetId = best?.id ?? null;
}

/**
 * GW2-style: a valid hard target wins; otherwise pick the enemy closest to the camera's
 * forward direction (weighted by distance), falling back to anything in melee range.
 */
function updateTargeting(w: CombatWorld, p: PlayerState, d: Dungeon, camYaw: number) {
  const hard = findEnemy(w, w.hardTargetId);
  if (hard && dist(p, hard) < TARGET_MAX_RANGE) {
    w.targetId = hard.id;
    return;
  }
  if (w.hardTargetId !== null && !hard) w.hardTargetId = null;

  const camFwd = Math.atan2(-Math.sin(camYaw), -Math.cos(camYaw));
  let best: Enemy | null = null;
  let bestScore = Infinity;
  for (const e of w.enemies) {
    const dd = dist(p, e);
    if (dd > SOFT_TARGET_RANGE) continue;
    const off = Math.abs(angleDiff(Math.atan2(e.x - p.x, e.z - p.z), camFwd));
    if (off > SOFT_TARGET_CONE && dd > 4) continue;
    if (!canSee(d, p, e)) continue;
    const score = dd * (1 + off * 1.5);
    if (score < bestScore) { bestScore = score; best = e; }
  }
  w.targetId = best?.id ?? null;
}

/** Angle the player should face while casting (null = no target). */
export function castFacing(w: CombatWorld, p: PlayerState): number | null {
  if (!w.cast) return null;
  const t = findEnemy(w, w.cast.targetId ?? w.targetId);
  return t ? Math.atan2(t.x - p.x, t.z - p.z) : null;
}

// ---------- Damage ----------

interface HitOpts {
  /** Skill dealing the damage — picks the damage-family multiplier (cone / projectile / area). */
  skill?: SkillDef;
  /** Burning tick: no crit, no lifesteal, no hit flash, burn multiplier instead of family. */
  burn?: boolean;
  /** Conditions to apply on hit. */
  statuses?: StatusApply[];
}

function familyMul(s: PlayerStats, skill?: SkillDef) {
  switch (skill?.kind) {
    case 'cone': return s.coneDamageMul;
    case 'projectile': return s.projectileDamageMul;
    case 'groundAoe': case 'selfAoe': case 'leap': return s.areaDamageMul;
    default: return 1;
  }
}

const isAfflicted = (e: Enemy) => has(e.status, 'burning') || has(e.status, 'chill') || has(e.status, 'vulnerability');

function applyCondition(e: Enemy, p: PlayerState, st: StatusApply) {
  applyStatus(e.status, st.id, st.stacks, st.duration * p.stats.conditionDurationMul);
}

function applyBoon(w: CombatWorld, st: StatusApply) {
  applyStatus(w.playerStatus, st.id, st.stacks, st.duration);
}

/**
 * All player-sourced damage goes through here so every modifier applies uniformly:
 * damage%, Might, damage family (traits), Vulnerability, Executioner, crits, lifesteal.
 */
function damageEnemy(w: CombatWorld, p: PlayerState, e: Enemy, base: number, opts: HitOpts = {}) {
  const s = p.stats;
  const crit = !opts.burn && Math.random() < s.critChance;
  let mul = s.damageMul + stacksOf(w.playerStatus, 'might') * 0.03;
  mul *= opts.burn ? s.burnDamageMul : familyMul(s, opts.skill);
  mul *= 1 + stacksOf(e.status, 'vulnerability') * 0.05;
  if (isAfflicted(e)) mul *= 1 + s.dmgVsAfflicted;
  if (crit) mul *= s.critMul;
  const amount = Math.max(1, Math.round(base * mul));
  e.hp -= amount;
  if (!opts.burn) e.hitFlash = 0.12;
  w.events.push({
    x: e.x, y: e.def.height + 0.3, z: e.z,
    text: crit ? `${amount}!` : String(amount), kind: opts.burn ? 'burn' : crit ? 'crit' : 'damage',
  });
  if (!opts.burn && s.lifesteal > 0 && !w.dead) healPlayer(w, p, amount * s.lifesteal, false);
  for (const st of opts.statuses ?? []) applyCondition(e, p, st);
  aggro(w, e);
  if (e.hp <= 0 && w.enemies.includes(e)) {
    w.enemies = w.enemies.filter((o) => o !== e);
    w.kills.push(e);
    // A dead caster's pending telegraph fizzles.
    w.telegraphs = w.telegraphs.filter((t) => t.ownerId !== e.id);
  }
}

function hitEnemiesInShape(w: CombatWorld, p: PlayerState, s: Shape, amount: number, opts: HitOpts = {}) {
  for (const e of [...w.enemies]) if (shapeHits(s, e.x, e.z, e.def.radius)) damageEnemy(w, p, e, amount, opts);
}

/** @param showText  false for small trickle heals (lifesteal) to avoid floating-text spam */
function healPlayer(w: CombatWorld, p: PlayerState, raw: number, showText = true) {
  const amount = Math.min(raw, w.maxHp - w.hp);
  if (amount <= 0) return;
  w.hp += amount;
  if (showText) w.events.push({ x: p.x, y: 2.3, z: p.z, text: `+${Math.round(amount)}`, kind: 'heal' });
}

const RIPOSTE_RADIUS = 3.5;

function damagePlayer(w: CombatWorld, p: PlayerState, amount: number) {
  if (isInvulnerable(p)) {
    w.events.push({ x: p.x, y: 2.3, z: p.z, text: 'Evade', kind: 'evade' });
    if (p.stats.riposteDamage > 0) {
      const shape: Shape = { kind: 'circle', x: p.x, z: p.z, r: RIPOSTE_RADIUS };
      hitEnemiesInShape(w, p, shape, p.stats.riposteDamage);
      w.telegraphs.push({ id: w.nextId++, shape, duration: 0.15, elapsed: 0, hostile: false, damage: 0, ownerId: null });
    }
    return;
  }
  const protection = has(w.playerStatus, 'protection') ? 0.67 : 1;
  const taken = Math.max(1, Math.round(amount * armorFactor(p.stats) * protection));
  w.hp = Math.max(0, w.hp - taken);
  w.events.push({ x: p.x, y: 2.3, z: p.z, text: String(taken), kind: 'hurt' });
  if (w.hp <= 0 && w.revives > 0) {
    // Undying: cheat death once.
    w.revives--;
    w.hp = Math.round(w.maxHp * 0.35);
    w.events.push({ x: p.x, y: 2.8, z: p.z, text: 'Undying!', kind: 'evade' });
    return;
  }
  if (w.hp <= 0) {
    w.dead = true;
    w.cast = null;
  }
}

// ---------- Fields & combos ----------

const MAX_FIELDS = 6;
const COMBO_RADIUS = 3.6;

function spawnField(w: CombatWorld, p: PlayerState, skill: SkillDef, x: number, z: number) {
  const f = skill.field!;
  const duration = f.duration * p.stats.fieldDurationMul;
  w.fields.push({
    id: w.nextId++, x, z, r: f.radius * p.stats.fieldRadiusMul, element: f.element,
    remaining: duration, duration, pulse: 0,
  });
  if (w.fields.length > MAX_FIELDS) w.fields.shift();
}

/** Most recent field containing the point (GW2 uses the newest overlapping field). */
export function fieldAt(w: CombatWorld, x: number, z: number): ComboField | undefined {
  for (let i = w.fields.length - 1; i >= 0; i--) {
    const f = w.fields[i];
    if (Math.hypot(f.x - x, f.z - z) <= f.r) return f;
  }
  return undefined;
}

/** Trait riders shared by every combo (Warlord, Undaunted) + the HUD/text announcement. */
function announceCombo(w: CombatWorld, p: PlayerState, element: FieldElement, finisher: Finisher) {
  const name = COMBOS[element][finisher].name;
  w.comboEvents.push({ element, finisher, name });
  w.events.push({ x: p.x, y: 3, z: p.z, text: name, kind: 'combo' });
  if (p.stats.comboMight > 0) applyBoon(w, { id: 'might', stacks: p.stats.comboMight, duration: 8 });
  if (p.stats.comboHealPct > 0) healPlayer(w, p, w.maxHp * p.stats.comboHealPct);
}

function enemiesNear(w: CombatWorld, x: number, z: number, r: number) {
  return w.enemies.filter((e) => Math.hypot(e.x - x, e.z - z) <= r + e.def.radius);
}

/** Blast / leap / whirl combo effects. Projectile combos resolve per hit in `projectileComboHit`. */
export function triggerCombo(w: CombatWorld, p: PlayerState, element: FieldElement, finisher: Exclude<Finisher, 'projectile'>, x: number, z: number) {
  const k = p.stats.comboPotency;
  const near = () => enemiesNear(w, x, z, COMBO_RADIUS);
  announceCombo(w, p, element, finisher);

  if (finisher === 'whirl' && element !== 'light') {
    // Spray 6 bolts outward carrying the field's element.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      w.projectiles.push({
        id: w.nextId++, x, z, prevX: x, prevZ: z, dirX: Math.sin(a), dirZ: Math.cos(a), speed: 20,
        damage: Math.round(10 * k), radius: 0.3, life: 0.6, targetId: null, combo: element, comboBolt: true,
      });
    }
    return;
  }

  switch (`${element}.${finisher}`) {
    case 'fire.blast': applyBoon(w, { id: 'might', stacks: Math.round(3 * k), duration: 8 }); break;
    case 'fire.leap': for (const e of near()) applyCondition(e, p, { id: 'burning', stacks: Math.round(3 * k), duration: 4 }); break;
    case 'ice.blast': applyBoon(w, { id: 'protection', stacks: 1, duration: 5 * k }); break;
    case 'ice.leap': for (const e of near()) applyCondition(e, p, { id: 'chill', stacks: 1, duration: 3 * k }); break;
    case 'light.blast': healPlayer(w, p, w.maxHp * 0.12 * k); break;
    case 'light.leap': applyBoon(w, { id: 'regeneration', stacks: 1, duration: 6 * k }); break;
    case 'light.whirl':
      healPlayer(w, p, w.maxHp * 0.08 * k);
      applyBoon(w, { id: 'regeneration', stacks: 1, duration: 3 * k });
      break;
    case 'arcane.blast': for (const e of near()) applyCondition(e, p, { id: 'vulnerability', stacks: Math.round(5 * k), duration: 6 }); break;
    case 'arcane.leap':
      applyBoon(w, { id: 'swiftness', stacks: 1, duration: 6 * k });
      applyBoon(w, { id: 'might', stacks: Math.round(2 * k), duration: 8 });
      break;
  }
}

/** On-hit effect of a projectile that passed through a field (or a whirl bolt). */
function projectileComboHit(w: CombatWorld, p: PlayerState, e: Enemy, element: FieldElement) {
  const k = p.stats.comboPotency;
  switch (element) {
    case 'fire': applyCondition(e, p, { id: 'burning', stacks: Math.round(2 * k), duration: 4 }); break;
    case 'ice': applyCondition(e, p, { id: 'chill', stacks: 1, duration: 2 * k }); break;
    case 'light': healPlayer(w, p, 6 * k, false); break;
    case 'arcane': applyCondition(e, p, { id: 'vulnerability', stacks: Math.round(3 * k), duration: 6 }); break;
  }
}

/** Blast/whirl finishers check for a field under the player when the skill resolves. */
function checkFinisher(w: CombatWorld, p: PlayerState, finisher: Finisher | undefined, x: number, z: number) {
  if (finisher !== 'blast' && finisher !== 'whirl' && finisher !== 'leap') return;
  const f = fieldAt(w, x, z);
  if (f) triggerCombo(w, p, f.element, finisher, x, z);
}

// ---------- Skills ----------

function tryStartCast(w: CombatWorld, p: PlayerState, d: Dungeon, slot: number) {
  const skill = w.kit[slot];
  if (!skill) return;
  if (w.cast || p.leap || p.dodgeTime > 0) {
    // Buffer non-auto presses so they aren't eaten by a dodge or an in-progress cast.
    if (slot !== 0 && w.cast?.slot !== slot) w.queued = { slot, t: SKILL_QUEUE_WINDOW };
    return;
  }
  if (w.cooldowns[slot] > 0) {
    // Only nag on fresh presses of non-auto skills (slot 1 is held to auto-attack).
    return slot === 0 ? undefined : setError(w, 'Skill recharging');
  }
  const target = findEnemy(w, w.targetId);
  if (skill.requiresTarget) {
    if (!target) return setError(w, 'No target');
    if (dist(p, target) > skill.range) return setError(w, 'Out of range');
  }
  w.cast = { skill, slot, remaining: skill.castTime * p.stats.castTimeMul, targetId: target?.id ?? null };
  w.skillEvents.push(skill);
  if (w.cast.remaining <= 0) finishCast(w, p, d);
}

function finishCast(w: CombatWorld, p: PlayerState, d: Dungeon) {
  const cast = w.cast!;
  const skill: SkillDef = cast.skill;
  const target = findEnemy(w, cast.targetId);
  w.cast = null;
  const s = p.stats;
  w.cooldowns[cast.slot] = cooldownOf(skill, p);

  const aim = target ? Math.atan2(target.x - p.x, target.z - p.z) : p.facing;
  const flash = (shape: Shape) =>
    w.telegraphs.push({ id: w.nextId++, shape, duration: 0.12, elapsed: 0, hostile: false, damage: 0, ownerId: null });
  const hitOpts: HitOpts = { skill, statuses: skill.statuses };

  for (const b of skill.buffs ?? []) applyBoon(w, b);
  // Blast & whirl finishers resolve against fields already on the ground — before this skill
  // lays its own field, so a skill never combos with itself.
  if (skill.finisher === 'blast' || skill.finisher === 'whirl') checkFinisher(w, p, skill.finisher, p.x, p.z);
  // Fields from non-ground skills go under you.
  if (skill.field && skill.kind !== 'groundAoe') spawnField(w, p, skill, p.x, p.z);

  switch (skill.kind) {
    case 'cone': {
      const shape: Shape = {
        kind: 'cone', x: p.x, z: p.z, dir: aim, range: skill.range, arc: s.conesFullCircle ? Math.PI * 2 : skill.arc!,
      };
      hitEnemiesInShape(w, p, shape, skill.damage, hitOpts);
      flash(shape);
      break;
    }

    case 'selfAoe': {
      const shape: Shape = { kind: 'circle', x: p.x, z: p.z, r: skill.radius! };
      hitEnemiesInShape(w, p, shape, skill.damage, hitOpts);
      flash(shape);
      break;
    }

    case 'projectile': {
      // Fan of `count` (+ Split Shot) projectiles centered on the aim; the center one homes if enabled.
      const n = (skill.count ?? 1) + s.extraProjectiles;
      const spread = skill.spread ?? 0.2;
      for (let i = 0; i < n; i++) {
        const a = aim + (i - (n - 1) / 2) * spread;
        const center = i === Math.floor((n - 1) / 2);
        w.projectiles.push({
          id: w.nextId++, x: p.x, z: p.z, prevX: p.x, prevZ: p.z,
          dirX: Math.sin(a), dirZ: Math.cos(a), speed: skill.speed!, damage: skill.damage,
          radius: skill.radius!, life: skill.range / skill.speed!,
          targetId: skill.homing && center ? target?.id ?? null : null, skill,
        });
      }
      break;
    }

    case 'groundAoe': {
      // On the target if in range, otherwise a short distance ahead (stopping short of walls).
      let tx: number, tz: number;
      if (target && dist(p, target) <= skill.range) { tx = target.x; tz = target.z; }
      else {
        const reach = reachAlong(d, p.x, p.z, aim, Math.min(8, skill.range));
        tx = p.x + Math.sin(aim) * reach;
        tz = p.z + Math.cos(aim) * reach;
      }
      w.telegraphs.push({
        id: w.nextId++, shape: { kind: 'circle', x: tx, z: tz, r: skill.radius! * s.groundAoeRadiusMul },
        duration: skill.delay!, elapsed: 0, hostile: false, damage: Math.round(skill.damage * s.groundAoeDamageMul), ownerId: null,
        skill,
      });
      break;
    }

    case 'leap': {
      const mode = skill.leapMode ?? 'target';
      let dir = aim, distance: number;
      if (mode === 'target') {
        if (!target) break;
        distance = Math.max(0, dist(p, target) - target.def.radius - playerTuning.radius - 0.2);
      } else {
        // Forward follows your facing (movement / camera); backward hops directly away from the
        // target if you have one (so kiting while running away doesn't hop you into it).
        dir = mode === 'forward' ? p.facing : (target ? aim : p.facing) + Math.PI;
        distance = reachAlong(d, p.x, p.z, dir, skill.range);
      }
      p.leap = {
        fromX: p.x, fromZ: p.z,
        toX: p.x + Math.sin(dir) * distance, toZ: p.z + Math.cos(dir) * distance,
        t: 0, dur: skill.leapDuration ?? 0.35, height: skill.leapHeight ?? 2.2,
        faceTravel: mode !== 'backward', landRadius: skill.radius ?? 0, landDamage: skill.damage,
        finisher: skill.finisher === 'leap', skill,
      };
      p.dodgeTime = 0;
      break;
    }

    case 'buff':
      break; // buffs/field already applied above
  }
}

/** How far you can travel from (x,z) along `angle` (up to `max`) before hitting a wall. */
function reachAlong(d: Dungeon, x: number, z: number, angle: number, max: number): number {
  const margin = playerTuning.radius + 0.1;
  let reach = 0;
  while (reach < max && !isWallAt(d, x + Math.sin(angle) * (reach + 0.25 + margin), z + Math.cos(angle) * (reach + 0.25 + margin))) {
    reach += 0.25;
  }
  return reach;
}

// ---------- Tick ----------

/** Input half: targeting + casting. Runs before the player moves. */
export function handleCombatInput(w: CombatWorld, p: PlayerState, input: Input, d: Dungeon, camYaw: number) {
  if (w.dead) return;
  if (input.wasPressed('Tab')) cycleTarget(w, p, d);
  if (input.wasPressed('KeyC')) targetNearest(w, p, d);
  if (input.wasPressed('Escape')) w.hardTargetId = null;
  updateTargeting(w, p, d, camYaw);

  if (w.queued && !w.cast && !p.leap && p.dodgeTime <= 0) {
    const { slot } = w.queued;
    w.queued = null;
    tryStartCast(w, p, d, slot);
  }

  SKILL_KEYS.forEach((code, slot) => {
    // Slot 1 auto-repeats while held; others fire on press.
    if (slot === 0 ? input.isDown(code) : input.wasPressed(code)) tryStartCast(w, p, d, slot);
  });
}

/** Simulation half: casts, projectiles, telegraph resolution. Runs after movement. */
export function updateCombat(w: CombatWorld, p: PlayerState, d: Dungeon, dt: number) {
  for (let i = 0; i < w.cooldowns.length; i++) w.cooldowns[i] = Math.max(0, w.cooldowns[i] - dt);
  if (w.error && (w.error.t -= dt) <= 0) w.error = null;
  if (w.queued && (w.queued.t -= dt) <= 0) w.queued = null;
  w.comboCooldown = Math.max(0, w.comboCooldown - dt);

  // Dodging interrupts casts (no cooldown spent), like GW2.
  if (w.cast && p.dodgeTime > 0) w.cast = null;
  if (w.cast && (w.cast.remaining -= dt) <= 0) finishCast(w, p, d);

  tickStatusEffects(w, p, dt);
  tickFields(w, p, dt);

  if (p.landed) {
    const l = p.landed;
    if (l.landDamage > 0 && l.landRadius > 0) {
      const shape: Shape = { kind: 'circle', x: p.x, z: p.z, r: l.landRadius };
      hitEnemiesInShape(w, p, shape, l.landDamage, { skill: l.skill, statuses: l.skill?.statuses });
      w.telegraphs.push({ id: w.nextId++, shape, duration: 0.15, elapsed: 0, hostile: false, damage: 0, ownerId: null });
    }
    // Leap finisher: a field where you land, or where you took off.
    if (l.finisher) {
      const f = fieldAt(w, p.x, p.z) ?? fieldAt(w, l.fromX, l.fromZ);
      if (f) triggerCombo(w, p, f.element, 'leap', p.x, p.z);
    }
    if (p.stats.leapHeal > 0) healPlayer(w, p, p.stats.leapHeal);
    p.endurance = Math.min(maxEnduranceOf(p), p.endurance + p.stats.leapEndurance);
  }

  // Projectiles: light homing toward their target, die on walls.
  for (const pr of [...w.projectiles]) {
    pr.prevX = pr.x;
    pr.prevZ = pr.z;
    const t = findEnemy(w, pr.targetId);
    if (t) {
      const dx = t.x - pr.x, dz = t.z - pr.z, l = Math.hypot(dx, dz) || 1;
      pr.dirX += (dx / l - pr.dirX) * 0.25;
      pr.dirZ += (dz / l - pr.dirZ) * 0.25;
      const n = Math.hypot(pr.dirX, pr.dirZ) || 1;
      pr.dirX /= n; pr.dirZ /= n;
    }
    pr.x += pr.dirX * pr.speed * dt;
    pr.z += pr.dirZ * pr.speed * dt;
    pr.life -= dt;
    // Projectile finisher: pick up the element of the first field it flies through.
    if (!pr.combo && pr.skill?.finisher === 'projectile') {
      const f = fieldAt(w, pr.x, pr.z);
      if (f) {
        pr.combo = f.element;
        // Announce once per volley (all projectiles of one cast share the moment).
        if (w.comboCooldown <= 0) { announceCombo(w, p, f.element, 'projectile'); w.comboCooldown = 0.4; }
      }
    }
    const hit = w.enemies.find((e) => Math.hypot(e.x - pr.x, e.z - pr.z) < e.def.radius + pr.radius);
    if (hit) {
      damageEnemy(w, p, hit, pr.damage, { skill: pr.skill, statuses: pr.skill?.statuses });
      if (pr.combo) projectileComboHit(w, p, hit, pr.combo);
    }
    if (hit || pr.life <= 0 || isWallAt(d, pr.x, pr.z)) w.projectiles = w.projectiles.filter((o) => o !== pr);
  }

  // Telegraphs resolve at the end of their duration.
  for (const tg of [...w.telegraphs]) {
    tg.elapsed += dt;
    if (tg.elapsed < tg.duration) continue;
    if (tg.damage > 0) {
      if (tg.hostile) {
        if (!w.dead && shapeHits(tg.shape, p.x, p.z, playerTuning.radius)) damagePlayer(w, p, tg.damage);
      } else {
        hitEnemiesInShape(w, p, tg.shape, tg.damage, { skill: tg.skill, statuses: tg.skill?.statuses });
      }
    }
    // Ground-targeted skills drop their field where they land.
    if (!tg.hostile && tg.skill?.field && tg.shape.kind === 'circle') spawnField(w, p, tg.skill, tg.shape.x, tg.shape.z);
    w.telegraphs = w.telegraphs.filter((o) => o !== tg);
  }
}

// ---------- Status effects & fields over time ----------

function tickStatusEffects(w: CombatWorld, p: PlayerState, dt: number) {
  for (const e of [...w.enemies]) {
    tickStatuses(e.status, dt, (id, stacks) => {
      if (id === 'burning' && w.enemies.includes(e)) damageEnemy(w, p, e, BURN_DPS_PER_STACK * stacks, { burn: true });
    });
  }
  tickStatuses(w.playerStatus, dt, (id) => {
    if (id === 'regeneration' && !w.dead) healPlayer(w, p, w.maxHp * REGEN_PCT, false);
  });
  p.speedMul = has(w.playerStatus, 'swiftness') ? 1.33 : 1;
}

/** Fields pulse once a second with a small effect of their element, then expire. */
function tickFields(w: CombatWorld, p: PlayerState, dt: number) {
  for (const f of [...w.fields]) {
    f.remaining -= dt;
    f.pulse += dt;
    if (f.pulse >= 1) {
      f.pulse -= 1;
      const inside = enemiesNear(w, f.x, f.z, f.r);
      switch (f.element) {
        case 'fire': for (const e of inside) applyCondition(e, p, { id: 'burning', stacks: 1, duration: 2 }); break;
        case 'ice': for (const e of inside) applyCondition(e, p, { id: 'chill', stacks: 1, duration: 1.5 }); break;
        case 'arcane': for (const e of inside) applyCondition(e, p, { id: 'vulnerability', stacks: 1, duration: 3 }); break;
        case 'light': if (Math.hypot(p.x - f.x, p.z - f.z) <= f.r) healPlayer(w, p, w.maxHp * 0.02, false); break;
      }
    }
    if (f.remaining <= 0) w.fields = w.fields.filter((o) => o !== f);
  }
}
