import { describe, expect, it } from "vitest";
import {
  CASINO_CASH_PRIZE,
  CASINO_STAKE,
  canGamble,
  drawCasinoReward,
  firstUnownedDeed,
} from "../convex/monopoly/casino";

describe("Casino entry", () => {
  it("uses a fixed $50 participation fee and a $200 cash prize", () => {
    expect(CASINO_STAKE).toBe(50);
    expect(CASINO_CASH_PRIZE).toBe(200);
    expect(canGamble(49)).toBe("You need $50 to gamble");
    expect(canGamble(50)).toBeNull();
  });

  it("has property, cash, and nothing outcomes", () => {
    expect(drawCasinoReward(() => 0)).toBe("property");
    expect(drawCasinoReward(() => 0.5)).toBe("cash");
    expect(drawCasinoReward(() => 0.99)).toBe("nothing");
  });

  it("selects the first deed not already owned", () => {
    expect(firstUnownedDeed([1, 3])?.index).toBe(5);
    expect(firstUnownedDeed([])?.index).toBe(1);
  });
});
