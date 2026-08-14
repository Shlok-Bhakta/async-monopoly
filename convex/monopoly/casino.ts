// Pure casino minigame logic for the Casino board space (index 20).
//
// Pure rules that can be unit tested with plain vitest — see
// tests/casino.test.ts. Mutations in convex/game.ts apply these to the game.

import { SPACES, type Space } from "./board";

export const CASINO_STAKE = 50;
export const CASINO_CASH_PRIZE = 200;

export type SlotsOutcome = "jackpot" | "pair" | "none";
export type OverUnderPick = "over" | "under";

export interface SlotsResult {
  outcome: SlotsOutcome;
  /** Absolute payout in dollars (0 on a loss). Stake is NOT returned. */
  payout: number;
}

export interface OverUnderResult {
  outcome: "win" | "lose";
  /** Absolute payout in dollars (0 on a loss). Stake is NOT returned. */
  payout: number;
}

/** The Casino awards the first available deed in board order. */
export function firstUnownedDeed(ownedSpaces: Iterable<number>): Space | null {
  const owned = new Set(ownedSpaces);
  return SPACES.find((space) => space.price !== undefined && !owned.has(space.index)) ?? null;
}

/** Roll three independent 1-6 reels. */
export function rollReels(): [number, number, number] {
  return [
    1 + Math.floor(Math.random() * 6),
    1 + Math.floor(Math.random() * 6),
    1 + Math.floor(Math.random() * 6),
  ];
}

/**
 * Three-reel slot machine.
 * - Jackpot (all three equal): pays $250 (5x stake)
 * - Pair (exactly two equal): pays $100 (2x stake)
 * - Nothing: pays $0
 * House edge ~2.8% (EV 48.61 on a $50 stake).
 */
export function spinSlots(reels: [number, number, number]): SlotsResult {
  const [a, b, c] = reels;
  if (a === b && b === c) return { outcome: "jackpot", payout: 250 };
  if (a === b || a === c || b === c) return { outcome: "pair", payout: 100 };
  return { outcome: "none", payout: 0 };
}

/**
 * Over/Under 7 table game (classic craps feel).
 * - Pick "over" or "under". Roll two dice.
 * - Sum > 7 wins if you picked over; sum < 7 wins if you picked under.
 * - Exactly 7 loses for both picks (house wins).
 * Win pays $100 (2x stake). House edge ~16.7% (EV 41.67 on a $50 stake).
 */
export function resolveOverUnder(pick: OverUnderPick, sum: number): OverUnderResult {
  const won = pick === "over" ? sum > 7 : sum < 7;
  return won ? { outcome: "win", payout: 100 } : { outcome: "lose", payout: 0 };
}

/** Can this player afford to gamble? Returns an error string or null. */
export function canGamble(money: number): string | null {
  if (money < CASINO_STAKE) return `You need $${CASINO_STAKE} to gamble`;
  return null;
}
