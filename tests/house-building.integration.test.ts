import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

async function gameForBuilding(options: {
  position?: number;
  properties?: number[];
  money?: number;
} = {}) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Alice" });
    const otherUserId = await ctx.db.insert("users", { name: "Bob" });
    const gameId = await ctx.db.insert("games", {
      name: "House-building test",
      code: "HOUSE1",
      status: "playing",
      createdBy: userId,
      createdAt: 1,
      startedAt: 1,
      turn: 0,
      phase: "manage",
      phaseData: {},
      doublesCount: 0,
      lastActionAt: 1,
      seed: 1,
    });
    const playerId = await ctx.db.insert("players", {
      gameId,
      userId,
      seatIndex: 0,
      token: "🚗 Car",
      name: "Alice",
      money: options.money ?? 1_000,
      position: options.position ?? 6,
      inJail: false,
      jailTurns: 0,
      getOutOfJailCards: 0,
      bankrupt: false,
      properties: options.properties ?? [1, 3],
      houses: [],
      mortgaged: [],
      joinedAt: 1,
    });
    await ctx.db.insert("players", {
      gameId,
      userId: otherUserId,
      seatIndex: 1,
      token: "🐕 Dog",
      name: "Bob",
      money: 1_000,
      position: 0,
      inJail: false,
      jailTurns: 0,
      getOutOfJailCards: 0,
      bankrupt: false,
      properties: [],
      houses: [],
      mortgaged: [],
      joinedAt: 1,
    });
    return { userId, gameId, playerId };
  });

  return {
    t,
    ...ids,
    asAlice: t.withIdentity({ subject: ids.userId }),
  };
}

describe("buildHouse landing requirement", () => {
  it("rejects a build when the player is not on a property in that color set", async () => {
    const { t, asAlice, gameId, playerId } = await gameForBuilding({ position: 6 });

    await expect(asAlice.mutation(api.game.buildHouse, { gameId, space: 1 })).rejects.toThrow(
      "Land on a property in this color set before building",
    );

    const player = await t.run((ctx) => ctx.db.get(playerId));
    expect(player?.houses).toEqual([]);
    expect(player?.money).toBe(1_000);
  });

  it("allows the unchanged house price when landing elsewhere in the same color set", async () => {
    const { t, asAlice, gameId, playerId } = await gameForBuilding({ position: 3 });

    await asAlice.mutation(api.game.buildHouse, { gameId, space: 1 });

    const player = await t.run((ctx) => ctx.db.get(playerId));
    expect(player?.houses).toEqual([{ space: 1, count: 1 }]);
    expect(player?.money).toBe(950);
  });

  it("still requires ownership of the full color set", async () => {
    const { t, asAlice, gameId, playerId } = await gameForBuilding({
      position: 1,
      properties: [1],
    });

    await expect(asAlice.mutation(api.game.buildHouse, { gameId, space: 1 })).rejects.toThrow(
      "You must own the whole color group",
    );

    const player = await t.run((ctx) => ctx.db.get(playerId));
    expect(player?.houses).toEqual([]);
    expect(player?.money).toBe(1_000);
  });
});
