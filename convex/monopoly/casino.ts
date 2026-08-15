// Pure casino minigame logic for the Casino board space (index 20).
//
// Pure rules that can be unit tested with plain vitest — see
// tests/casino.test.ts. Mutations in convex/game.ts apply these to the game.

import { SPACES, type Space } from "./board";

export const CASINO_STAKE = 50;
export const CASINO_CASH_PRIZE = 200;
export type CasinoReward = "property" | "cash" | "nothing";

/** The Casino awards the first available deed in board order. */
export function firstUnownedDeed(ownedSpaces: Iterable<number>): Space | null {
  const owned = new Set(ownedSpaces);
  return SPACES.find((space) => space.price !== undefined && !owned.has(space.index)) ?? null;
}

/** Can this player afford to gamble? Returns an error string or null. */
export function canGamble(money: number): string | null {
  if (money < CASINO_STAKE) return `You need $${CASINO_STAKE} to gamble`;
  return null;
}

/** Equal odds of a deed, cash, or no reward after paying the entry fee. */
export function drawCasinoReward(random: () => number = Math.random): CasinoReward {
  const roll = random();
  if (roll < 1 / 3) return "property";
  if (roll < 2 / 3) return "cash";
  return "nothing";
}
