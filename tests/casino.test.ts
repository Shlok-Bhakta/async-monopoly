// Unit tests for the Casino minigames (convex/monopoly/casino.ts).
//
// The casino replaced Free Parking (space 20). Landing there opens a "casino"
// phase where the turn player can spin the slots or bet over/under 7. The
// logic is pure so we can verify payouts AND the house edge exhaustively.

import { describe, expect, it } from "vitest";
import {
  CASINO_STAKE,
  canGamble,
  resolveOverUnder,
  spinSlots,
} from "../convex/monopoly/casino";

describe("spinSlots", () => {
  it("pays the jackpot on three of a kind", () => {
    expect(spinSlots([4, 4, 4])).toEqual({ outcome: "jackpot", payout: 250 });
    expect(spinSlots([1, 1, 1])).toEqual({ outcome: "jackpot", payout: 250 });
  });

  it("pays a pair for exactly two equal reels in any position", () => {
    expect(spinSlots([3, 3, 5])).toEqual({ outcome: "pair", payout: 100 });
    expect(spinSlots([3, 5, 3])).toEqual({ outcome: "pair", payout: 100 });
    expect(spinSlots([5, 3, 3])).toEqual({ outcome: "pair", payout: 100 });
  });

  it("pays nothing for three distinct reels", () => {
    expect(spinSlots([1, 2, 3])).toEqual({ outcome: "none", payout: 0 });
    expect(spinSlots([6, 1, 4])).toEqual({ outcome: "none", payout: 0 });
  });

  it("never confuses a jackpot with a pair", () => {
    expect(spinSlots([2, 2, 2]).outcome).toBe("jackpot");
  });

  it("house edge is small but positive across all 216 reel combos", () => {
    const counts = { jackpot: 0, pair: 0, none: 0 };
    let totalPayout = 0;
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        for (let c = 1; c <= 6; c++) {
          const { outcome, payout } = spinSlots([a, b, c]);
          counts[outcome]++;
          totalPayout += payout;
        }
      }
    }
    expect(counts).toEqual({ jackpot: 6, pair: 90, none: 120 });
    // EV per $50 spin must be under the stake (house wins) but not predatory.
    const ev = totalPayout / 216;
    expect(ev).toBeLessThan(CASINO_STAKE);
    expect(ev).toBeGreaterThan(CASINO_STAKE * 0.9);
  });
});

describe("resolveOverUnder", () => {
  it("over 7 wins on sums 8-12", () => {
    for (let sum = 8; sum <= 12; sum++) {
      expect(resolveOverUnder("over", sum)).toEqual({ outcome: "win", payout: 100 });
    }
  });

  it("over 7 loses on sums 2-7", () => {
    for (let sum = 2; sum <= 7; sum++) {
      expect(resolveOverUnder("over", sum)).toEqual({ outcome: "lose", payout: 0 });
    }
  });

  it("under 7 wins on sums 2-6", () => {
    for (let sum = 2; sum <= 6; sum++) {
      expect(resolveOverUnder("under", sum)).toEqual({ outcome: "win", payout: 100 });
    }
  });

  it("under 7 loses on sums 7-12", () => {
    for (let sum = 7; sum <= 12; sum++) {
      expect(resolveOverUnder("under", sum)).toEqual({ outcome: "lose", payout: 0 });
    }
  });

  it("exactly 7 is the house win for both picks", () => {
    expect(resolveOverUnder("over", 7)).toEqual({ outcome: "lose", payout: 0 });
    expect(resolveOverUnder("under", 7)).toEqual({ outcome: "lose", payout: 0 });
  });

  it("pays 2x on a win across all 36 dice combos (15 winning, 21 losing)", () => {
    let wins = 0;
    let totalPayout = 0;
    for (let a = 1; a <= 6; a++) {
      for (let b = 1; b <= 6; b++) {
        const { outcome, payout } = resolveOverUnder("over", a + b);
        if (outcome === "win") wins++;
        totalPayout += payout;
      }
    }
    expect(wins).toBe(15);
    expect(totalPayout).toBe(1500);
    // EV 41.67 on a $50 stake — classic craps-style house edge (~16.7%).
    expect(totalPayout / 36).toBeLessThan(CASINO_STAKE * 2);
  });
});

describe("canGamble", () => {
  it("requires the $50 stake", () => {
    expect(canGamble(0)).toContain("$50");
    expect(canGamble(49)).toContain("$50");
    expect(canGamble(50)).toBeNull();
    expect(canGamble(500)).toBeNull();
  });
});

describe("full casino visit money flow", () => {
  it("jackpot: stake $50, win $250 -> net +$200", () => {
    const money = 100;
    const afterStake = money - CASINO_STAKE;
    const { payout } = spinSlots([5, 5, 5]);
    expect(afterStake + payout).toBe(300);
    expect(payout - CASINO_STAKE).toBe(200);
  });

  it("losing spin: stake is gone, no payout", () => {
    const money = 100;
    const afterStake = money - CASINO_STAKE;
    const { payout } = spinSlots([1, 2, 3]);
    expect(payout).toBe(0);
    expect(afterStake).toBe(50);
  });

  it("over 7 win: net +$50; loss: net -$50; 7: net -$50", () => {
    expect(resolveOverUnder("over", 9).payout - CASINO_STAKE).toBe(50);
    expect(resolveOverUnder("over", 3).payout - CASINO_STAKE).toBe(-50);
    expect(resolveOverUnder("over", 7).payout - CASINO_STAKE).toBe(-50);
  });
});
