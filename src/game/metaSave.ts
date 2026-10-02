import { type MetaRanks, metaById, rankOf, spentOn, upgradeCost } from '../data/meta';

/** Persistent progression. Stored in localStorage (works in browsers and Electron alike). */
export interface MetaSave {
  version: 1;
  shards: number;
  ranks: MetaRanks;
  stats: { runs: number; bestFloor: number; totalKills: number; totalShards: number };
  /** Per class: chosen skill ids for slots 1–5. */
  loadouts?: Record<string, string[]>;
  /** Per class: chosen trait id per tier. */
  traits?: Record<string, (string | null)[]>;
}

const KEY = 'roguelike.meta.v1';

export const emptySave = (): MetaSave => ({
  version: 1, shards: 0, ranks: {}, stats: { runs: 0, bestFloor: 0, totalKills: 0, totalShards: 0 },
});

export function loadMeta(storage: Pick<Storage, 'getItem'> | null = safeStorage()): MetaSave {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return emptySave();
    const parsed = JSON.parse(raw) as Partial<MetaSave>;
    if (parsed.version !== 1) return emptySave();
    const base = emptySave();
    return { ...base, ...parsed, ranks: { ...parsed.ranks }, stats: { ...base.stats, ...parsed.stats } };
  } catch {
    return emptySave();
  }
}

export function saveMeta(save: MetaSave, storage: Pick<Storage, 'setItem'> | null = safeStorage()) {
  try {
    storage?.setItem(KEY, JSON.stringify(save));
  } catch {
    /* storage full or blocked — progress just won't persist this session */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Buy the next rank. Returns false if maxed or unaffordable. */
export function buyRank(save: MetaSave, id: string): boolean {
  const def = metaById(id);
  if (!def) return false;
  const r = rankOf(save.ranks, id);
  if (r >= def.maxRank) return false;
  const cost = upgradeCost(def, r);
  if (save.shards < cost) return false;
  save.shards -= cost;
  save.ranks[id] = r + 1;
  return true;
}

/** Refund every rank at full price (lets players re-spec freely). */
export function refundAll(save: MetaSave) {
  for (const [id, r] of Object.entries(save.ranks)) {
    const def = metaById(id);
    if (def) save.shards += spentOn(def, r);
  }
  save.ranks = {};
}

export function recordRun(save: MetaSave, shards: number, floor: number, kills: number) {
  save.shards += shards;
  save.stats.runs++;
  save.stats.bestFloor = Math.max(save.stats.bestFloor, floor);
  save.stats.totalKills += kills;
  save.stats.totalShards += shards;
}
