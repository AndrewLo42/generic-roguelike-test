import { type EquipSlot, type GearItem, type Item, EQUIP_SLOTS, MAX_POTION_STACK, SLOTS, makePotion } from '../data/items';

export const BAG_SIZE = 20;

/**
 * Run-long inventory: a fixed-size bag plus one item per equipment slot. `equipped.weapon` is the
 * active weapon set and `equipped.weapon2` the swap set (its stats don't count). Pure data + helpers.
 */
export interface Inventory {
  bag: (Item | null)[];
  equipped: Record<EquipSlot, GearItem | null>;
}

export function createInventory(startingPotions = 2): Inventory {
  const inv: Inventory = {
    bag: new Array<Item | null>(BAG_SIZE).fill(null),
    equipped: Object.fromEntries(EQUIP_SLOTS.map((s) => [s, null])) as Record<EquipSlot, GearItem | null>,
  };
  if (startingPotions > 0) addItem(inv, makePotion(startingPotions));
  return inv;
}

/** Gear that counts toward stats — everything equipped except the swap weapon. */
export const equippedGear = (inv: Inventory): GearItem[] =>
  SLOTS.map((s) => inv.equipped[s]).filter((g): g is GearItem => !!g);

/** Adds to the bag (potions stack first). Returns false if there's no room. */
export function addItem(inv: Inventory, item: Item): boolean {
  if (item.kind === 'potion') {
    let left = item.count;
    for (const it of inv.bag) {
      if (it?.kind === 'potion' && it.count < MAX_POTION_STACK) {
        const take = Math.min(left, MAX_POTION_STACK - it.count);
        it.count += take;
        left -= take;
        if (!left) return true;
      }
    }
    item.count = left;
  }
  const free = inv.bag.indexOf(null);
  if (free < 0) return false;
  inv.bag[free] = item;
  return true;
}

/**
 * Equip gear from a bag slot, swapping whatever was equipped back into that bag slot.
 * `toSwapSet` puts a weapon into the swap set instead of the active one.
 */
export function equipFromBag(inv: Inventory, bagIndex: number, toSwapSet = false): boolean {
  const item = inv.bag[bagIndex];
  if (item?.kind !== 'gear') return false;
  const slot: EquipSlot = item.slot === 'weapon' && toSwapSet ? 'weapon2' : item.slot;
  inv.bag[bagIndex] = inv.equipped[slot];
  inv.equipped[slot] = item;
  return true;
}

/** Exchange the active and swap weapon sets. Returns false if there's no swap weapon. */
export function swapWeaponSets(inv: Inventory): boolean {
  if (!inv.equipped.weapon2) return false;
  [inv.equipped.weapon, inv.equipped.weapon2] = [inv.equipped.weapon2, inv.equipped.weapon];
  return true;
}

/** Move equipped gear into the first free bag slot. Returns false if the bag is full. */
export function unequip(inv: Inventory, slot: EquipSlot): boolean {
  const item = inv.equipped[slot];
  if (!item) return false;
  const free = inv.bag.indexOf(null);
  if (free < 0) return false;
  inv.bag[free] = item;
  inv.equipped[slot] = null;
  return true;
}

export function discard(inv: Inventory, bagIndex: number): Item | null {
  const item = inv.bag[bagIndex];
  inv.bag[bagIndex] = null;
  return item;
}

export const potionCount = (inv: Inventory) =>
  inv.bag.reduce((n, it) => n + (it?.kind === 'potion' ? it.count : 0), 0);

/** Consume one potion from the smallest stack. Returns false if none. */
export function consumePotion(inv: Inventory): boolean {
  let best = -1;
  inv.bag.forEach((it, i) => {
    if (it?.kind === 'potion' && (best < 0 || it.count < (inv.bag[best] as { count: number }).count)) best = i;
  });
  if (best < 0) return false;
  const stack = inv.bag[best]!;
  if (stack.kind === 'potion' && --stack.count <= 0) inv.bag[best] = null;
  return true;
}
