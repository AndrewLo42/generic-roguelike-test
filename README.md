# Three.js Roguelike (PoC)

GW2-style action combat + seeded procedural dungeons, built with Three.js + TypeScript + Vite.

```bash
npm install
npm run dev        # http://localhost:5173  (?seed=42 fixed layout, ?class=warrior|ranger|mage skips the menu)
npm test           # generator determinism / connectivity tests
```

**Controls:** W/S move · A/D strafe · Q/E turn (strafe while holding RMB) · Space jump · V/Shift dodge (costs 50 endurance, i-frames) · H potion · F open chest · P inventory / K skills / T traits (pauses) · 1–5 skills (hold 1 to auto-attack) · Tab / left-click target, C nearest enemy, Esc clear · hold RMB to steer camera · wheel zoom · R restart run (same class) · blue portal = next floor (seed + 1, +30% HP). Tuning lives in the collapsed *Debug* panel.

**Classes** (picked from the start menu, and again after each death):

| Class | HP | Default skills 1–5 |
|---|---|---|
| Warrior (melee) | 260 | Cleave · Savage Leap (gap-closer + landing AoE) · Whirling Strike (AoE around you, whirl finisher) · Flame Brand (fire field) · Warhorn (Swiftness + Might) |
| Ranger (ranged, +10% speed) | 200 | Long Shot (homing arrow) · Volley (5-arrow fan) · Fire Trap (fire field) · Disengage (hop away from target) · Hunter's Call (Swiftness + Might) |
| Rogue (assassin, +8% speed) | 210 | Twin Strikes (poison) · Backstab (+60% from behind) · Shadowstep (teleport behind + 1s Stealth) · Smoke Bomb (smoke field, blinds) · Death Blossom (poison whirl) |
| Mage (caster) | 170 | Arcane Bolt · Flame Burst (fast small AoE) · Meteor (big slow AoE, fire field) · Frost Nova (blast + ice field) · Blink (teleport forward) |

There are no dedicated healing skills. Sustain comes from **Regeneration** (2.5% max HP/s) on several skills — Warhorn, Battle Standard, Hunter's Call, Disengage, Frost Nova, Blink, Sunfire — plus lifesteal, light-field combos and scarce **potions (H)**.

**Skill loadouts (K):** each class has a pool of 9–10 skills; in the pause menu's **Skills** tab click a slot, then any skill to put it there (fully free — any skill in any slot; picking one already slotted swaps them). Loadouts are remembered per class.

**Combos (GW2 fields + finishers):** some skills leave an elemental **field** (🔥 fire, ❄ ice, ☀ light, ✦ arcane) that also pulses a small effect each second; others are **finishers** (➹ projectile, 💥 blast, ⤴ leap, 🌀 whirl). Shoot through a field or use a finisher inside one to trigger a combo — e.g. Meteor's fire field + Frost Nova (blast) = Fire Blast (Might); Fire Trap + Volley = burning arrows; Battle Standard (light) + Whirling Strike = Healing Whirl. The Skills tab has the full 4×4 combo table with the ones your current loadout can do highlighted. A skill never combos with its own field. Data: `src/data/combos.ts`; effects: `triggerCombo` in `src/systems/combat.ts`.

**Statuses:** enemies — Burning (DoT), Poisoned (stacking DoT), Chilled (−45% speed), Vulnerable (+5% damage taken per stack), Blinded (their next attack misses); you — Might (+3% damage/stack), Regeneration, Swiftness, Protection (−33% damage taken), Stealth.

**Rogue mechanics:** *Backstab* — hits from an enemy's rear arc deal bonus damage (Rogue passive +30%, Backstab skill +60% more). *Stealth* — enemies lose track of you (idle ones won't notice you; chasers freeze and keep facing where they were looking, which is how you get behind them); your next damaging skill is an *Ambush* (+30% for everyone, +80% for the Rogue) and breaks Stealth. Sources: Shadowstep (1s), Vanish (3s), and the new ☁ *smoke field* — blast or leap inside it for Stealth, shoot through it to Blind. Core loop: Smoke Bomb → Shadowstep (Shadow Leap) → Backstab. Shown as icons on nameplates and above your health bar. `src/combat/status.ts`.

**Traits (T):** 4 tiers × 3 choices per class (Adept / Master / Combos / Grandmaster) — skill-family damage, cast speed, condition and field duration, combo potency, and grandmaster riders like *Warlord* (combos grant Might) or *Undaunted* (combos heal). Not resource-gated yet; free to swap, remembered per class. `src/data/traits.ts`.

Skills are data in `src/data/skills.ts`; each has a `kind` (cone, projectile, groundAoe, selfAoe, leap, buff) that `systems/combat.ts` knows how to run, so new skills are usually data-only. Classes in `src/data/classes.ts`. Skills pressed mid-dodge/cast are queued for 0.6s; dodging cancels a cast.

**Rewards:** touching the portal pauses the game and offers 3 boons (4 if you killed every enemy on the floor); pick with click or 1–4. Boons stack for the run and reset on death. Commons are stat bumps (damage, HP, speed, cooldowns…), rares add mechanics (crits, lifesteal, Split Shot, Riposte on evade…), epics are build-defining (Whirlwind, Glass Cannon, Acrobat). Skill-specific boons only show up for classes that have that kind of skill (no Split Shot for Warrior). Owned boons show bottom-left (hover for details). Defined in `src/data/boons.ts`.

**Items & loot:** enemies sometimes drop gear (Skeleton 14%, Hexer 18%, Bone Brute 45%) and health potions (3%). Each floor has 1–3 chests (press **F** near one) holding 2–3 magic-or-better items and sometimes a potion (30%). Walk over loot to pick it up; rare/epic items have a light beam. Gear has 5 slots (weapon, head, chest, boots, trinket) and 4 rarities (common → magic → rare → epic) with more/bigger random affixes; deeper floors roll better rarities and bigger numbers. Weapons are named for your class. **Armor** reduces damage taken by `100 / (100 + armor)`. **H** drinks a potion (35% max HP, 6s cooldown). Inventory resets on death. Items in `src/data/items.ts`, drops in `src/systems/loot.ts`.

**Pause / inventory (P):** pauses the game. Shows character stats, 5 equipment slots and a 20-slot bag. Click bag gear to equip (swaps), click equipped gear to unequip, click a potion to drink, right-click to discard. Hovering shows the item plus ▲/▼ comparison against what's equipped. P or Esc resumes; "Abandon run" returns to class select.

**Permanent upgrades (meta-progression):** every run ends (death or "Abandon run") with a summary that pays out **Soul Shards**: 10 + 5×floor for each floor cleared (deeper floors pay more), 1 per kill (+2 for Bone Brutes), 4 per chest (10 for gold). Spend them in **Upgrades** (button on the run summary and on the class select screen) on 12 ranked upgrades that apply to every class and every future run: Vitality (max HP %), Might (damage), Fortitude (armor), Swiftness, Focus (cooldowns), Precision (crit), Stamina (endurance regen), Provisions (starting potions), Scavenger (drop chance), Fortune (more shards), Blessing (start with random boons) and Undying (cheat death once per run). Costs grow ×1.55 per rank; "Refund all" gives everything back so you can re-spec. Progress is saved in `localStorage` (key `roguelike.meta.v1`); the Debug panel has "+100 Soul Shards" and "reset progression". R (quick restart) skips the payout. Defined in `src/data/meta.ts`, save logic in `src/game/metaSave.ts`.

**Enemies:** Skeleton (frontal cleave), Bone Brute (big slam around itself), Hexer (ranged AoE dropped on your position). Every attack shows a red ground telegraph that fills up — dodge out of it or roll through it with i-frames ("Evade").

## Layout
```
src/
  core/            rng (seeded mulberry32), input (polled per tick)
  world/dungeon/   generator.ts (pure data, no Three) + meshBuilder.ts (InstancedMesh, ~2 draw calls)
  world/collision  circle-vs-tile-grid push-out
  data/            skills.ts, classes.ts, enemies.ts, boons.ts, items.ts — tune numbers here
  game/            inventory.ts (bag + equipment, pure data)
  combat/          world.ts (plain-data combat state), shapes.ts (circle/cone hit tests)
  systems/         player (movement, dodge, jump, leap), camera (spring arm),
                   enemies (spawning, BFS flow-field pathing, FSM), combat (targeting, skills, projectiles, telegraphs)
  render/          assets.ts (KayKit loader/registry), animatedModel.ts (base + upper/full-body overlay layers),
                   playerView.ts, combatView.ts (enemies, telegraphs, corpses, floating text), lootView.ts, torchLights.ts
  ui/              HTML overlay HUD (HP, endurance, skill bar, cast bar, target frame)
  main.ts          fixed 60Hz logic tick, interpolated rendering
```
Rule of thumb: simulation/generation code stays free of Three.js so it's testable and could later run on a server.

## Milestones
1. ✅ Scaffold, fixed-timestep loop, debug GUI
2. ✅ Movement, third-person camera w/ wall pull-in, dodge + endurance
3. ✅ Seeded dungeon gen (rooms → MST + loops → L corridors), floor progression
4. ✅ Combat: enemy FSM, soft/hard targeting, 5 data-driven skills, telegraphs, dodge evades, damage numbers
5. ✅ Roguelike loop: seeded per-room spawns scaling with floor, boon draft between floors, death → new run
6. ✅ Asset pass: KayKit characters, skeleton enemies, dungeon tiles/walls/torches/chests, animations (see below)
7. ⬜ Electron shell + packaging
8. ⬜ Later: open terrain zones (noise heightmap chunks, same spawner API)

## Assets (all CC0 unless noted — record everything in `public/assets/CREDITS.md`)
**In use:** KayKit Adventurers (Knight = Warrior, Rogue_Hooded = Ranger, Mage), Skeletons (Minion = Skeleton, Warrior = Bone Brute, Mage = Hexer) and Dungeon Remastered, in `public/assets/kaykit/` (~28 MB, uncompressed). How they're wired:
- Which model/weapon/animations each class, enemy and skill uses is data: `visual` in `classes.ts` / `enemies.ts`, `anim` in `skills.ts`. Both packs share one rig, so skeletons borrow weapons from the adventurer files (attached to `handslotr`).
- Skill animations are sped up so the clip's impact frame lands when the cast resolves; enemy attack swings likewise connect when their telegraph fills. While moving, casts play on the upper body only and the legs keep running.
- Dungeon walls are laid along floor edges (paired into 4-wide pieces), with pillars at inner corners and a pool of 6 torch lights that follow the player. Everything static is instanced.
- If any file fails to load, that piece falls back to the old primitive placeholder.

**More sources:**
- **KayKit** (kaylousberg.itch.io) — more packs share the same rig/style (e.g. Barbarian, Druid, Engineer in the paid "Extra" pack).
- **Quaternius** (quaternius.com) — Ultimate Monsters, Modular Dungeon, animated characters.
- **Kenney** (kenney.nl) — dungeon kits, UI, particles, SFX.
- **Poly Pizza** — search aggregator; check per-model license (some CC-BY).
- **Mixamo** — free animations for humanoid rigs (usable in games, don't redistribute raw files).
- VFX: three.quarks + Kenney particle textures. Audio: Kenney, Sonniss GDC bundles.
- Pipeline: GLB only → `gltf-transform` (Meshopt/Draco + KTX2) → `GLTFLoader` + `AnimationMixer`. *Not done yet* — the KayKit character files each carry ~80 animations and could shrink a lot.

## Portability
- **Web:** `npm run build` → static `dist/` for itch.io / any static host.
- **Desktop (target):** Electron + electron-builder (Win/macOS/Linux). Bundled Chromium = consistent WebGL/WebGPU. Steam via `steamworks.js`. Keep Electron APIs behind a small `platform/` adapter (saves, fullscreen, Steam) so the web build still works.
- Alternatives: Tauri (tiny builds, OS webview varies), Capacitor (mobile).
- Renderer can move to `WebGPURenderer` later with minimal scene changes.
