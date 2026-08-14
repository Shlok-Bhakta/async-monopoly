// Pure Monopoly rules engine helpers. Mutations in convex/game.ts use these.

import {
  getSpace,
  GROUPS,
  RAILROAD_RENTS,
  UTILITY_MULTIPLIERS,
  groupSpaces,
  isGroupMonopolized,
  railroadCount,
  utilityCount,
  GO_SALARY,
  JAIL_BAIL,
  MAX_JAIL_TURNS,
} from "./board";

export const MONOPOLY_RENT_BONUS = 0.05;

export function rollDice(): [number, number] {
  return [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
}

export function isDoubles(dice: number[]): boolean {
  return dice[0] === dice[1];
}

export function moveStockValue(investment: number, currentValue: number, percent: number): number {
  const change = Math.round(investment * percent / 100);
  return Math.max(0, currentValue + change);
}

// Player shape used by the engine (subset of the Convex players doc).
export interface EnginePlayer {
  _id: string;
  money: number;
  position: number;
  inJail: boolean;
  jailTurns: number;
  jailVisits?: number;
  getOutOfJailCards: number;
  bankrupt: boolean;
  properties: number[];
  houses: { space: number; count: number }[];
  mortgaged: number[];
}

export function houseCount(player: EnginePlayer, space: number): number {
  return player.houses.find((h) => h.space === space)?.count ?? 0;
}

export function totalHouses(player: EnginePlayer): number {
  return player.houses.reduce((sum, h) => sum + h.count, 0);
}

export function totalHotels(player: EnginePlayer): number {
  return player.houses.filter((h) => h.count === 5).length;
}

export function monopolyCount(properties: number[]): number {
  return Object.keys(GROUPS).filter((group) => isGroupMonopolized(properties, group)).length;
}

export function monopolyRentMultiplier(properties: number[]): number {
  return 1 + monopolyCount(properties) * MONOPOLY_RENT_BONUS;
}

// Advance by `steps`, collecting GO salary if we pass (but not land on) GO.
export function moveBySteps(player: EnginePlayer, steps: number): { position: number; salary: number } {
  let salary = 0;
  let pos = player.position + steps;
  if (pos >= 40) {
    if (!player.inJail) salary = GO_SALARY;
    pos = pos % 40;
  }
  return { position: pos, salary };
}

// Move to an absolute space. `collectOnPass` applies when the player crosses GO.
export function moveToSpace(
  player: EnginePlayer,
  target: number,
  collectOnPass: boolean,
): { position: number; salary: number } {
  let salary = 0;
  if (collectOnPass && target < player.position && !player.inJail) {
    salary = GO_SALARY;
  }
  return { position: target, salary };
}

export interface RentInfo {
  amount: number;
  breakdown: string;
}

function rentModifiers(owner: EnginePlayer, cardMultiplier: number): { multiplier: number; label: string } {
  const monopolies = monopolyCount(owner.properties);
  const bonusPercent = monopolies * MONOPOLY_RENT_BONUS * 100;
  const bonusLabel = monopolies > 0
    ? ` +${bonusPercent}% (${monopolies} monopol${monopolies === 1 ? "y" : "ies"})`
    : "";
  const cardLabel = cardMultiplier !== 1 ? ` x${cardMultiplier} (card)` : "";
  return {
    multiplier: (1 + bonusPercent / 100) * cardMultiplier,
    label: `${bonusLabel}${cardLabel}`,
  };
}

// Compute rent owed for landing on `spaceIndex` owned by `owner`.
// multiplier: e.g. 2 when a Chance card says "pay double".
export function computeRent(
  spaceIndex: number,
  owner: EnginePlayer,
  diceSum: number,
  multiplier = 1,
): RentInfo {
  const space = getSpace(spaceIndex);
  if (owner.inJail) {
    return { amount: 0, breakdown: "Owner in Jail — no rent" };
  }
  if (owner.mortgaged.includes(spaceIndex)) {
    return { amount: 0, breakdown: "Mortgaged — no rent" };
  }
  const modifiers = rentModifiers(owner, multiplier);
  if (space.type === "property") {
    const houses = houseCount(owner, spaceIndex);
    if (houses === 0) {
      const base = space.rents![0];
      return {
        amount: base * modifiers.multiplier,
        breakdown: `Base ${base}${modifiers.label}`,
      };
    }
    const rent = space.rents![houses];
    const label = houses === 5 ? "hotel" : `${houses} house${houses > 1 ? "s" : ""}`;
    return { amount: rent * modifiers.multiplier, breakdown: `${label} rent ${rent}${modifiers.label}` };
  }
  if (space.type === "railroad") {
    const count = railroadCount(owner.properties);
    const rent = RAILROAD_RENTS[count - 1];
    return {
      amount: rent * modifiers.multiplier,
      breakdown: `${count} railroad${count > 1 ? "s" : ""} => $${rent}${modifiers.label}`,
    };
  }
  if (space.type === "utility") {
    const count = utilityCount(owner.properties);
    const mult = UTILITY_MULTIPLIERS[count - 1];
    const rent = diceSum * mult;
    return {
      amount: rent * modifiers.multiplier,
      breakdown: `${count} utilit${count === 1 ? "y" : "ies"} => ${mult} x dice(${diceSum})${modifiers.label}`,
    };
  }
  return { amount: 0, breakdown: "" };
}

// Number of alive (non-bankrupt) players.
export function alivePlayers(players: EnginePlayer[]): EnginePlayer[] {
  return players.filter((p) => !p.bankrupt);
}

// Next alive seat after `fromSeat`, in seat order. Returns seat index or -1.
export function nextAliveSeat(players: EnginePlayer[], fromSeat: number): number {
  const n = players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (fromSeat + step) % n;
    if (!players[idx].bankrupt) return idx;
  }
  return -1;
}

// Sell all houses/hotels back to the bank at half price (used in bankruptcy).
export function liquidateHouses(player: EnginePlayer): number {
  const value = player.houses.reduce((sum, h) => {
    const space = getSpace(h.space);
    return sum + h.count * Math.floor((space.houseCost ?? 0) / 2);
  }, 0);
  player.houses = [];
  return value;
}

export function assetValue(player: EnginePlayer): number {
  let value = player.money;
  for (const space of player.properties) {
    const s = getSpace(space);
    value += player.mortgaged.includes(space) ? s.mortgage ?? 0 : s.price ?? 0;
  }
  for (const h of player.houses) {
    const s = getSpace(h.space);
    value += h.count * (s.houseCost ?? 0);
  }
  return value;
}

// Can `player` build a house on `space`? Returns error string or null.
export function canBuild(
  player: EnginePlayer,
  spaceIndex: number,
  houseSupply: number,
  hotelSupply: number,
): string | null {
  const space = getSpace(spaceIndex);
  if (space.type !== "property") return "Not a buildable property";
  if (player.bankrupt) return "Bankrupt players cannot build";
  if (!player.properties.includes(spaceIndex)) return "You do not own this property";
  if (player.mortgaged.includes(spaceIndex)) return "Unmortgage this property first";
  const group = space.group!;
  if (!isGroupMonopolized(player.properties, group)) return "You must own the whole color group";
  const owned = groupSpaces(group);
  const counts = owned.map((s) => houseCount(player, s.index));
  const current = houseCount(player, spaceIndex);
  if (current >= 5) return "Already has a hotel";
  // Even building rule: no space can have more than 1 more house than another.
  const minOther = Math.min(...counts.filter((_, i) => owned[i].index !== spaceIndex));
  if (current > minOther) return "Build evenly across the group";
  const nextCount = current + 1;
  if (nextCount === 5 && hotelSupply <= 0) return "No hotels left in the bank";
  if (nextCount < 5 && houseSupply <= 0) return "No houses left in the bank";
  if (player.money < (space.houseCost ?? 0)) return "Not enough money";
  return null;
}

export function jailStatus(player: EnginePlayer): string | null {
  if (!player.inJail) return null;
  if (player.jailTurns >= MAX_JAIL_TURNS) return "mustPay";
  return "options";
}

export function jailBailAmount(player: Pick<EnginePlayer, "jailVisits">): number {
  return JAIL_BAIL * Math.max(1, player.jailVisits ?? 1);
}

export const JAIL_BAIL_AMOUNT = JAIL_BAIL;
