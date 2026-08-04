// Unit tests for the pure Monopoly rules engine (convex/monopoly/engine.ts).
// The engine is dependency-free, so these run without Convex.

import { describe, expect, it } from "vitest";
import {
  assetValue,
  canBuild,
  computeRent,
  isDoubles,
  liquidateHouses,
  moveBySteps,
  moveToSpace,
  nextAliveSeat,
  totalHouses,
  totalHotels,
  type EnginePlayer,
} from "../convex/monopoly/engine";

function player(overrides: Partial<EnginePlayer> = {}): EnginePlayer {
  return {
    _id: "p1",
    money: 1500,
    position: 0,
    inJail: false,
    jailTurns: 0,
    getOutOfJailCards: 0,
    bankrupt: false,
    properties: [],
    houses: [],
    mortgaged: [],
    ...overrides,
  };
}

describe("moveBySteps", () => {
  it("moves forward without salary below GO", () => {
    expect(moveBySteps(player({ position: 5 }), 3)).toEqual({ position: 8, salary: 0 });
  });

  it("pays GO salary when passing GO", () => {
    expect(moveBySteps(player({ position: 38 }), 4)).toEqual({ position: 2, salary: 200 });
    expect(moveBySteps(player({ position: 39 }), 1)).toEqual({ position: 0, salary: 200 });
  });

  it("does not pay salary when landing exactly on GO from 0", () => {
    expect(moveBySteps(player({ position: 0 }), 0)).toEqual({ position: 0, salary: 0 });
  });
});

describe("moveToSpace", () => {
  it("pays salary only when crossing GO backwards-to-forward", () => {
    expect(moveToSpace(player({ position: 34 }), 2, true)).toEqual({ position: 2, salary: 200 });
    expect(moveToSpace(player({ position: 10 }), 20, true)).toEqual({ position: 20, salary: 0 });
    expect(moveToSpace(player({ position: 30 }), 5, false)).toEqual({ position: 5, salary: 0 });
  });
});

describe("isDoubles", () => {
  it("detects doubles", () => {
    expect(isDoubles([3, 3])).toBe(true);
    expect(isDoubles([3, 4])).toBe(false);
  });
});

describe("computeRent", () => {
  it("charges base rent on a single property", () => {
    const owner = player({ properties: [1] });
    expect(computeRent(1, owner, 0)).toEqual({ amount: 2, breakdown: "Base 2" });
  });

  it("doubles base rent when the group is monopolized", () => {
    const owner = player({ properties: [1, 3] });
    const rent = computeRent(1, owner, 0);
    expect(rent.amount).toBe(4);
    expect(rent.breakdown).toContain("x2 (monopoly)");
  });

  it("charges house rent when houses are built", () => {
    const owner = player({ properties: [1, 3], houses: [{ space: 1, count: 2 }] });
    expect(computeRent(1, owner, 0).amount).toBe(30); // 2 houses => $30
    expect(computeRent(1, owner, 0).breakdown).toContain("2 houses");
  });

  it("charges hotel rent at 5 houses", () => {
    const owner = player({ properties: [1, 3], houses: [{ space: 1, count: 5 }] });
    expect(computeRent(1, owner, 0).amount).toBe(250);
  });

  it("charges nothing for a mortgaged property", () => {
    const owner = player({ properties: [1], mortgaged: [1] });
    expect(computeRent(1, owner, 0)).toEqual({ amount: 0, breakdown: "Mortgaged — no rent" });
  });

  it("charges railroad rent based on number owned", () => {
    const one = player({ properties: [5] });
    expect(computeRent(5, one, 0).amount).toBe(25);
    const two = player({ properties: [5, 15] });
    expect(computeRent(5, two, 0).amount).toBe(50);
  });

  it("charges utility rent based on dice and utilities owned", () => {
    const one = player({ properties: [12] });
    expect(computeRent(12, one, 6).amount).toBe(24); // 4x dice
    const two = player({ properties: [12, 28] });
    expect(computeRent(12, two, 6).amount).toBe(60); // 10x dice
  });

  it("applies a card multiplier on top of the rent", () => {
    const owner = player({ properties: [1, 3] });
    expect(computeRent(1, owner, 0, 2).amount).toBe(8); // 2 * 2 (monopoly) * 2 (card)
  });
});

describe("nextAliveSeat", () => {
  const seats: EnginePlayer[] = [player({ _id: "a" }), player({ _id: "b" }), player({ _id: "c", bankrupt: true }), player({ _id: "d" })];

  it("skips bankrupt players and wraps around", () => {
    expect(nextAliveSeat(seats, 0)).toBe(1);
    expect(nextAliveSeat(seats, 1)).toBe(3); // skips bankrupt seat 2
    expect(nextAliveSeat(seats, 3)).toBe(0); // wraps
  });

  it("returns -1 when everyone is bankrupt", () => {
    const allOut = seats.map((p) => ({ ...p, bankrupt: true }));
    expect(nextAliveSeat(allOut, 0)).toBe(-1);
  });
});

describe("canBuild", () => {
  const owner = player({ money: 1000, properties: [1, 3] });

  it("requires the whole color group", () => {
    const solo = player({ money: 1000, properties: [1] });
    expect(canBuild(solo, 1, 32, 12)).toBe("You must own the whole color group");
  });

  it("enforces the even-build rule", () => {
    const uneven = { ...owner, houses: [{ space: 1, count: 2 }] };
    expect(canBuild(uneven, 1, 32, 12)).toBe("Build evenly across the group");
  });

  it("allows an even build and checks supply/money", () => {
    expect(canBuild(owner, 1, 32, 12)).toBeNull();
    expect(canBuild(owner, 1, 0, 12)).toBe("No houses left in the bank");
    const broke = { ...owner, money: 10 };
    expect(canBuild(broke, 1, 32, 12)).toBe("Not enough money");
  });

  it("refuses hotels when the hotel supply is empty", () => {
    const ready = { ...owner, houses: [{ space: 1, count: 4 }, { space: 3, count: 4 }] };
    expect(canBuild(ready, 1, 32, 0)).toBe("No hotels left in the bank");
    expect(canBuild(ready, 1, 32, 12)).toBeNull();
  });
});

describe("totalHouses / totalHotels / liquidateHouses / assetValue", () => {
  it("counts houses and hotels", () => {
    const p = player({ houses: [{ space: 1, count: 2 }, { space: 3, count: 5 }] });
    expect(totalHouses(p)).toBe(7);
    expect(totalHotels(p)).toBe(1);
  });

  it("liquidates houses at half price", () => {
    const p = player({ houses: [{ space: 1, count: 2 }] }); // houseCost 50
    expect(liquidateHouses(p)).toBe(50);
    expect(p.houses).toEqual([]);
  });

  it("values cash, unmortgaged properties at price, mortgaged at mortgage value", () => {
    const p = player({ money: 100, properties: [1, 5], mortgaged: [5] });
    // 100 + 60 (Mediterranean) + 100 (Reading mortgaged)
    expect(assetValue(p)).toBe(260);
  });
});
