import * as THREE from 'three';
import GUI from 'lil-gui';
import { Input } from './core/input';
import { generateDungeon, roomCenter, type Dungeon } from './world/dungeon/generator';
import { buildDungeonMesh, disposeGroup, tileToWorld } from './world/dungeon/meshBuilder';
import { createPlayer, playerTuning, updatePlayer, type PlayerState } from './systems/player';
import { ThirdPersonCamera, cameraTuning } from './systems/camera';
import { FlowField, spawnEnemies, updateEnemies } from './systems/enemies';
import { castFacing, handleCombatInput, updateCombat } from './systems/combat';
import { createCombatWorld, type CombatWorld } from './combat/world';
import { maxHpOf, type PlayerStats } from './combat/stats';
import { type BoonStacks, computeStats, rollOffers } from './data/boons';
import { CLASSES, type ClassDef, classById, kitKinds, loadoutKey, resolveLoadout, weaponFor } from './data/classes';
import type { WeaponDef } from './data/weapons';
import type { TraitPicks } from './data/traits';
import { ITEM_RARITY_COLOR, POTION_HEAL_PCT, type ItemSlot, makeStarterWeapon } from './data/items';
import { type Inventory, addItem, consumePotion, createInventory, discard, equipFromBag, equippedGear, potionCount, unequip } from './game/inventory';
import { type LootContext, createLootContext, nearestClosedChest, openChest, rollKillDrops, spawnChests, updatePickups } from './systems/loot';
import { CombatView } from './render/combatView';
import { LootView } from './render/lootView';
import { PlayerView } from './render/playerView';
import { TorchLights } from './render/torchLights';
import { loadAssets } from './render/assets';
import { buildSkillBar, pushFeed, setPrompt, showBanner, updateBuffs, updateHud, updatePotionSlot } from './ui/hud';
import { choose, closeRewards, isRewardOpen, openRewards, renderOwnedBoons } from './ui/rewards';
import { chooseClass, isClassSelectOpen, openClassSelect } from './ui/classSelect';
import { type PauseTab, closePause, isPauseOpen, openPause, renderPause, setPauseTab } from './ui/inventoryMenu';
import { closeUpgrades, continueFromSummary, isSummaryOpen, isUpgradesOpen, renderClassMeta, showRunSummary } from './ui/metaMenu';
import { type RunSummary, rankOf, shardsForRun } from './data/meta';
import { type MetaSave, emptySave, loadMeta, recordRun, saveMeta } from './game/metaSave';

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d12);
scene.fog = new THREE.Fog(0x0b0d12, 25, 60);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
const tpCam = new ThirdPersonCamera(camera);

// Cool, dim fill + a moonlight key for shadows; torches supply the warm local light.
scene.add(new THREE.HemisphereLight(0xa8b4e0, 0x3a3028, 1.6));
const sun = new THREE.DirectionalLight(0xc8d4ff, 1.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 80 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

// ---------- Assets (KayKit) — loaded before anything is built ----------
const loading = document.getElementById('loading')!;
const assetsOk = await loadAssets((done, total) => {
  loading.querySelector('span')!.textContent = `${Math.round((done / total) * 100)}%`;
});
loading.remove();
if (!assetsOk) console.warn('Some KayKit assets failed to load — using placeholders where missing.');

const playerView = new PlayerView(scene);
const torchLights = new TorchLights(scene);

// ---------- World state ----------
const input = new Input(renderer.domElement);
let dungeon: Dungeon;
let dungeonGroup: THREE.Group | null = null;
let exitObj: THREE.Object3D;
let player: PlayerState;
let combat: CombatWorld;
let flow: FlowField;
let floor = 1;
let deathTimer = 0;
// Run state: persists across floors, reset on death / new run.
let cls: ClassDef = CLASSES[0];
let boons: BoonStacks = {};
let inv: Inventory = createInventory();
// Permanent progression (persisted) + this run's tallies for the shard payout.
const meta: MetaSave = loadMeta();
let stats: PlayerStats = computeStats(boons, cls, [], meta.ranks);
let lootCtx: LootContext;
const persistMeta = () => saveMeta(meta);
/** The equipped weapon's type decides the weapon skills; no weapon equipped = the class's primary weapon. */
const currentWeapon = (): WeaponDef => weaponFor(cls.id, inv.equipped.weapon?.weaponType);
let weapon: WeaponDef = currentWeapon();
/**
 * Saved skill loadout (slots 1–5) per class + weapon, and trait picks per class — remembered between runs.
 * Loadouts saved before weapons existed (keyed by class only) still apply to the primary weapon.
 */
const loadoutFor = (c: ClassDef, w: WeaponDef) =>
  resolveLoadout(c, w, meta.loadouts?.[loadoutKey(c, w)] ?? (w === c.weapons[0] ? meta.loadouts?.[c.id] : undefined));
const traitsFor = (c: ClassDef): TraitPicks => meta.traits?.[c.id] ?? [];
let run: RunSummary = { classId: cls.id, floor: 1, kills: 0, bruteKills: 0, chests: 0, goldChests: 0 };
let revivesLeft = 0;
let potionCd = 0;
const POTION_COOLDOWN = 6;
const worldUi = document.getElementById('world-ui')!;
const combatView = new CombatView(scene, camera, worldUi);
const lootView = new LootView(scene, camera, worldUi);
const raycaster = new THREE.Raycaster();

/**
 * Recompute stats after boons or gear change and push them to the live player/combat state.
 * Max-HP increases from boons heal by the gain; gear swaps only cap (so swapping can't heal).
 */
function refreshStats(healGain = false) {
  const oldMax = maxHpOf(stats);
  stats = computeStats(boons, cls, equippedGear(inv), meta.ranks, traitsFor(cls));
  const newMax = maxHpOf(stats);
  if (player) player.stats = stats;
  if (combat) {
    combat.maxHp = newMax;
    if (healGain) combat.hp += Math.max(0, newMax - oldMax);
    combat.hp = Math.min(combat.hp, newMax);
  }
}

function startRun(seed: number, c: ClassDef = cls) {
  cls = c;
  floor = 1;
  boons = {};
  run = { classId: cls.id, floor: 1, kills: 0, bruteKills: 0, chests: 0, goldChests: 0 };
  inv = createInventory(2 + rankOf(meta.ranks, 'provisions'));
  // One statless starter per weapon type: the last-used one equipped, the rest in the bag.
  const lastWeapon = weaponFor(cls.id, meta.weapons?.[cls.id]);
  for (const w of cls.weapons) {
    const item = makeStarterWeapon(cls.id, w.id);
    if (w === lastWeapon) inv.equipped.weapon = item;
    else addItem(inv, item);
  }
  weapon = currentWeapon();
  revivesLeft = rankOf(meta.ranks, 'undying');
  potionCd = 0;
  // Blessing: start with random boons that fit the class.
  const blessed = rollOffers(seed * 17 + 5, {}, rankOf(meta.ranks, 'blessing'), kitKinds(cls, weapon));
  for (const b of blessed) boons[b.id] = 1;
  stats = computeStats(boons, cls, equippedGear(inv), meta.ranks, traitsFor(cls));
  playerView.setClass(cls, weapon);
  buildSkillBar(loadoutFor(cls, weapon));
  renderOwnedBoons(boons);
  closeRewards();
  loadFloor(seed, maxHpOf(stats));
  for (const b of blessed) pushFeed(`✨ Blessing: ${b.icon} ${b.name}`);
}

/** Show the class picker; the chosen class starts a fresh run. */
function promptClass(subtitle?: string, seed = randomSeed()) {
  renderClassMeta(meta, persistMeta);
  openClassSelect((c) => startRun(seed, c), subtitle);
}

/** Run over (death or abandon): bank Soul Shards, show the summary, then back to class select. */
function endRun(reason: 'died' | 'abandoned') {
  run.floor = floor;
  const { total, breakdown } = shardsForRun(run, meta.ranks);
  recordRun(meta, total, floor, run.kills);
  persistMeta();
  showRunSummary(
    reason === 'died' ? `Fell on floor ${floor}` : `Run abandoned on floor ${floor}`,
    `${cls.name} · ${run.kills} kills · ${Object.values(boons).reduce((a, b) => a + b, 0)} boons`,
    breakdown, total, meta, persistMeta,
    () => promptClass('Spend Soul Shards on upgrades, then choose a class for your next run.'),
  );
}

/** Portal reached: pause and draft a boon, then descend. Clearing the floor earns a 4th choice. */
function enterRewards() {
  const cleared = combat.enemies.length === 0;
  const offers = rollOffers(dungeon.seed * 131 + 17, boons, cleared ? 4 : 3, kitKinds(cls, weapon));
  const descend = () => {
    const newMax = maxHpOf(stats);
    floor++;
    loadFloor(dungeon.seed + 1, Math.min(newMax, combat.hp + newMax * 0.3));
  };
  if (!offers.length) return descend(); // everything maxed
  openRewards(offers, boons, cleared, floor, (b) => {
    boons[b.id] = (boons[b.id] ?? 0) + 1;
    refreshStats(true);
    renderOwnedBoons(boons);
    descend();
  });
}

function loadFloor(seed: number, hp: number) {
  combatView.clear();
  lootView.clear();
  if (dungeonGroup) {
    scene.remove(dungeonGroup);
    disposeGroup(dungeonGroup);
  }
  dungeon = generateDungeon(seed);
  const built = buildDungeonMesh(dungeon);
  dungeonGroup = built.group;
  exitObj = built.exit;
  torchLights.setTorches(built.torches);
  playerView.resetRun();
  scene.add(dungeonGroup);

  const [sx, sy] = roomCenter(dungeon.rooms[dungeon.startRoom]);
  const spawn = tileToWorld(sx, sy);
  player = createPlayer(spawn.x, spawn.z, stats);
  combat = createCombatWorld(hp, maxHpOf(stats), loadoutFor(cls, weapon));
  combat.revives = revivesLeft;
  spawnEnemies(combat, dungeon, floor);
  spawnChests(combat, dungeon, floor);
  lootCtx = createLootContext(seed, floor, cls.id, 1 + 0.12 * rankOf(meta.ranks, 'scavenger'));
  flow = new FlowField(dungeon);
  // Face the camera toward the exit so the first frame is oriented sensibly.
  tpCam.yaw = Math.atan2(spawn.x - exitObj.position.x, spawn.z - exitObj.position.z);
  showBanner(`Floor ${floor}`);
}

const randomSeed = () => Math.floor(Math.random() * 1e6);
const params = new URLSearchParams(location.search);
const initialSeed = Number(params.get('seed')) || randomSeed();
// ?class=warrior|ranger|mage skips the menu (handy while iterating).
const urlClass = classById(params.get('class') ?? '');
startRun(initialSeed, urlClass ?? CLASSES[0]);
if (!urlClass) promptClass(undefined, initialSeed);

// ---------- Debug GUI ----------
const gui = new GUI({ title: 'Debug' });
const debug = {
  seed: dungeon!.seed,
  regenerate: () => startRun(debug.seed),
  openRewards: () => { if (!isRewardOpen()) enterRewards(); },
  changeClass: () => { if (!isClassSelectOpen()) promptClass('Starts a new run'); },
  grantShards: () => { meta.shards += 100; persistMeta(); renderClassMeta(meta, persistMeta); },
  resetProgress: () => {
    if (!confirm('Wipe all Soul Shards and permanent upgrades?')) return;
    Object.assign(meta, emptySave());
    persistMeta();
    renderClassMeta(meta, persistMeta);
  },
};
const gPlayer = gui.addFolder('Player');
gPlayer.add(playerTuning, 'moveSpeed', 2, 15);
gPlayer.add(playerTuning, 'dodgeSpeed', 8, 30);
gPlayer.add(playerTuning, 'dodgeDuration', 0.1, 0.8);
gPlayer.add(playerTuning, 'enduranceRegen', 0, 100);
gPlayer.add(playerTuning, 'jumpVelocity', 2, 15);
gPlayer.add(playerTuning, 'gravity', 5, 50);
const gCam = gui.addFolder('Camera');
gCam.add(cameraTuning, 'sensitivity', 0.001, 0.01);
gCam.add(cameraTuning, 'keyTurnRate', 1, 6);
gCam.add(camera, 'fov', 40, 90).onChange(() => camera.updateProjectionMatrix());
const gWorld = gui.addFolder('World');
gWorld.add(debug, 'seed').step(1);
gWorld.add(debug, 'regenerate');
gWorld.add(debug, 'openRewards').name('open rewards (skip floor)');
gWorld.add(debug, 'changeClass').name('change class');
const gMeta = gui.addFolder('Progression');
gMeta.add(debug, 'grantShards').name('+100 Soul Shards');
gMeta.add(debug, 'resetProgress').name('reset progression');
gui.close();

// ---------- Pause / inventory ----------
function openInventory(tab: PauseTab = 'inventory') {
  openPause(
    () => ({ inv, stats, cls, weapon, hp: combat.hp, maxHp: combat.maxHp, floor, loadout: combat.kit, traits: traitsFor(cls) }),
    {
      setSlot: (slot, skillId) => {
        const ids = combat.kit.map((k) => k.id);
        const already = ids.indexOf(skillId);
        if (already >= 0) ids[already] = ids[slot]; // swap
        ids[slot] = skillId;
        meta.loadouts = { ...meta.loadouts, [loadoutKey(cls, weapon)]: ids };
        persistMeta();
        applyLoadout();
        renderPause();
      },
      setTrait: (tier, traitId) => {
        const picks = [...traitsFor(cls)];
        picks[tier] = traitId;
        meta.traits = { ...meta.traits, [cls.id]: picks };
        persistMeta();
        refreshStats();
        renderPause();
      },
      equip: (i) => { if (equipFromBag(inv, i)) { refreshStats(); syncWeapon(); renderPause(); } },
      unequip: (slot: ItemSlot) => {
        if (unequip(inv, slot)) { refreshStats(); syncWeapon(); renderPause(); }
        else pushFeed('<span style="color:#ff6b5e">Bag is full</span>');
      },
      discard: (i) => { discard(inv, i); renderPause(); },
      usePotion: () => { drinkPotion(); renderPause(); },
      resume: () => closePause(),
      abandon: () => { closePause(); endRun('abandoned'); },
    },
    tab,
  );
}

/** After gear changes: if the weapon type changed, swap weapon skills, held props and the remembered weapon. */
function syncWeapon() {
  const next = currentWeapon();
  if (next === weapon) return;
  weapon = next;
  meta.weapons = { ...meta.weapons, [cls.id]: weapon.id };
  persistMeta();
  playerView.setWeapon(weapon);
  applyLoadout();
  pushFeed(`${weapon.icon} Now wielding <b>${weapon.name}</b> — weapon skills changed`);
}

/** Swap the live kit to the saved loadout; slots that keep the same skill keep their cooldown. */
function applyLoadout() {
  const next = loadoutFor(cls, weapon);
  combat.cooldowns = next.map((s, i) => (combat.kit[i]?.id === s.id ? combat.cooldowns[i] : 0));
  if (combat.cast && combat.kit[combat.cast.slot]?.id !== next[combat.cast.slot]?.id) combat.cast = null;
  combat.queued = null;
  combat.kit = next;
  buildSkillBar(next);
}

function drinkPotion() {
  if (potionCd > 0 || combat.dead) return;
  if (combat.hp >= combat.maxHp) { combat.error = { text: 'Already at full health', t: 1 }; return; }
  if (!consumePotion(inv)) { combat.error = { text: 'No potions', t: 1 }; return; }
  const amount = Math.min(combat.maxHp - combat.hp, Math.round(combat.maxHp * POTION_HEAL_PCT * stats.healMul));
  combat.hp += amount;
  combat.events.push({ x: player.x, y: 2.3, z: player.z, text: `+${amount}`, kind: 'heal' });
  potionCd = POTION_COOLDOWN;
}

// ---------- Fixed-timestep loop ----------
const STEP = 1 / 60;
let accumulator = 0;
let last = performance.now();
let fps = 60;
const renderPos = new THREE.Vector3();

function tick(dt: number) {
  // Menus pause the simulation; number keys pick a card.
  const digits = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
  if (isUpgradesOpen()) {
    if (input.wasPressed('Escape')) closeUpgrades();
    input.endTick();
    return;
  }
  if (isSummaryOpen()) {
    if (input.wasPressed('Enter') || input.wasPressed('Space')) continueFromSummary();
    input.endTick();
    return;
  }
  if (isClassSelectOpen()) {
    digits.forEach((code, i) => input.wasPressed(code) && chooseClass(i));
    input.endTick();
    return;
  }
  if (isRewardOpen()) {
    digits.forEach((code, i) => input.wasPressed(code) && choose(i));
    input.endTick();
    return;
  }
  if (isPauseOpen()) {
    if (input.wasPressed('KeyP') || input.wasPressed('Escape')) closePause();
    else if (input.wasPressed('KeyK')) setPauseTab('skills');
    else if (input.wasPressed('KeyT')) setPauseTab('traits');
    input.endTick();
    return;
  }
  const menuKey = input.wasPressed('KeyP') ? 'inventory' : input.wasPressed('KeyK') ? 'skills' : input.wasPressed('KeyT') ? 'traits' : null;
  if (menuKey && !combat.dead) {
    openInventory(menuKey);
    input.endTick();
    return;
  }

  if (input.wasPressed('KeyR')) {
    startRun(randomSeed());
    debug.seed = dungeon.seed;
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  const keyTurning = tpCam.handleInput(input, dt);

  if (combat.dead) {
    player.prevX = player.x;
    player.prevZ = player.z;
    player.prevY = player.y;
    updateEnemies(combat, player, dungeon, flow, dt);
    updateCombat(combat, player, dungeon, dt);
    if ((deathTimer -= dt) <= 0) endRun('died');
    input.endTick();
    return;
  }

  // Click-to-target: raycast enemy meshes under the cursor.
  if (input.leftClick) {
    const ndc = new THREE.Vector2(
      (input.leftClick.x / window.innerWidth) * 2 - 1,
      -(input.leftClick.y / window.innerHeight) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(combatView.pickables, false)[0];
    combat.hardTargetId = hit ? (hit.object.userData.enemyId as number) : null;
  }

  handleCombatInput(combat, player, input, dungeon, tpCam.yaw);
  updatePlayer(player, input, tpCam.yaw, input.rmb || keyTurning, input.rmb, dungeon, dt, castFacing(combat, player));
  updateEnemies(combat, player, dungeon, flow, dt);
  updateCombat(combat, player, dungeon, dt);

  // Potions (H), chests (F), drops and walk-over pickup.
  potionCd = Math.max(0, potionCd - dt);
  if (input.wasPressed('KeyH')) drinkPotion();
  const chest = nearestClosedChest(combat, player);
  setPrompt(chest ? '<kbd>F</kbd> Open chest' : '');
  if (chest && input.wasPressed('KeyF')) {
    openChest(combat, dungeon, lootCtx, chest);
    run.chests++;
    if (chest.gold) run.goldChests++;
  }
  for (const k of rollKillDrops(combat, dungeon, lootCtx)) {
    run.kills++;
    if (k.def.id === 'brute') run.bruteKills++;
  }
  revivesLeft = combat.revives;
  const { picked, full } = updatePickups(combat, player, inv, dt);
  for (const it of picked) {
    const color = it.kind === 'potion' ? '#ff8a80' : ITEM_RARITY_COLOR[it.rarity];
    pushFeed(`<span style="color:${color}">${it.icon} ${it.name}${it.kind === 'potion' && it.count > 1 ? ` ×${it.count}` : ''}</span>`);
  }
  if (full && !combat.error) combat.error = { text: 'Bag is full — press P to manage inventory', t: 1.5 };

  if (combat.dead) {
    deathTimer = 3;
    showBanner(`You died on floor ${floor}`, 2500);
  }

  // Portal: draft a boon, then descend with +30% HP.
  if (!combat.dead && Math.hypot(player.x - exitObj.position.x, player.z - exitObj.position.z) < 1.4) {
    enterRewards();
  }
  input.endTick();
}

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  fps += (1 / Math.max(dt, 1e-4) - fps) * 0.05;

  accumulator += dt;
  while (accumulator >= STEP) {
    tick(STEP);
    accumulator -= STEP;
  }

  // Interpolate render position between the last two logic states.
  const a = accumulator / STEP;
  const rx = player.prevX + (player.x - player.prevX) * a;
  const rz = player.prevZ + (player.z - player.prevZ) * a;
  const ry = player.prevY + (player.y - player.prevY) * a;
  // Menus freeze animation along with the simulation.
  const animDt = isPauseOpen() || isRewardOpen() || isClassSelectOpen() || isSummaryOpen() || isUpgradesOpen() ? 0 : dt;
  playerView.update(player, combat, renderPos.set(rx, ry, rz), animDt);

  exitObj.rotation.y += animDt * 1.5;

  sun.position.set(rx + 12, 25, rz + 8);
  sun.target.position.set(rx, 0, rz);
  torchLights.update(rx, rz, dt);

  combatView.sync(combat, a, combat.hardTargetId !== null && combat.hardTargetId === combat.targetId, animDt);
  lootView.sync(combat, rx, rz, animDt);
  tpCam.update(rx, rz, dungeon, dt);
  renderer.render(scene, camera);
  combatView.updateOverlay(combat, dt);
  updateHud(player, combat, cls, dungeon.seed, floor, fps, renderer.info.render.calls);
  updatePotionSlot(potionCount(inv), potionCd, POTION_COOLDOWN);
  updateBuffs(combat);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Exposed for debugging in the console.
Object.assign(window, {
  __game: { get player() { return player; }, get dungeon() { return dungeon; }, get combat() { return combat; }, get boons() { return boons; }, get stats() { return stats; }, get floor() { return floor; }, get cls() { return cls; }, get inv() { return inv; }, get weapon() { return weapon; }, scene, loadFloor, enterRewards },
});
