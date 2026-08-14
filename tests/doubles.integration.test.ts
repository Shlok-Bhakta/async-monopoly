import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

async function gameBeforeDoubles(options: {
  aliceMoney?: number;
  alicePosition?: number;
  aliceProperties?: number[];
  bobProperties?: number[];
  doublesCount?: number;
} = {}) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Alice" });
    const otherUserId = await ctx.db.insert("users", { name: "Bob" });
    const gameId = await ctx.db.insert("games", {
      name: "Doubles regression test",
      code: "DOUBLE",
      status: "playing",
      createdBy: userId,
      createdAt: 1,
      startedAt: 1,
      turn: 0,
      phase: "roll",
      phaseData: {},
      doublesCount: options.doublesCount ?? 0,
      lastActionAt: 1,
      seed: 1,
    });
    const playerId = await ctx.db.insert("players", {
      gameId,
      userId,
      seatIndex: 0,
      token: "🚗 Car",
      name: "Alice",
      money: options.aliceMoney ?? 1_000,
      position: options.alicePosition ?? 1,
      inJail: false,
      jailTurns: 0,
      getOutOfJailCards: 0,
      bankrupt: false,
      properties: options.aliceProperties ?? [],
      houses: [],
      mortgaged: [],
      joinedAt: 1,
    });
    const otherPlayerId = await ctx.db.insert("players", {
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
      properties: options.bobProperties ?? [],
      houses: [],
      mortgaged: [],
      joinedAt: 1,
    });
    return { userId, gameId, playerId, otherPlayerId };
  });

  return { t, ...ids, asAlice: t.withIdentity({ subject: ids.userId }) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("doubles bonus roll", () => {
  it("remains available after the player buys the property they landed on", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // 1 + 1 moves from 1 to Baltic Avenue.
    const { t, asAlice, gameId, playerId } = await gameBeforeDoubles();

    await asAlice.mutation(api.game.roll, { gameId });
    await asAlice.mutation(api.game.buyProperty, { gameId });

    const result = await t.run(async (ctx) => ({
      game: await ctx.db.get(gameId),
      player: await ctx.db.get(playerId),
    }));
    expect(result.player?.properties).toEqual([3]);
    expect(result.game).toMatchObject({ turn: 0, phase: "roll", doublesCount: 1 });
  });

  it("remains available after the player raises cash and pays rent", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // 1 + 1 moves from 1 to Bob's Baltic Avenue.
    const { t, asAlice, gameId, playerId, otherPlayerId } = await gameBeforeDoubles({
      aliceMoney: 1,
      aliceProperties: [5],
      bobProperties: [3],
    });

    await asAlice.mutation(api.game.roll, { gameId });
    await asAlice.mutation(api.game.mortgage, { gameId, space: 5 });
    await asAlice.mutation(api.game.settleDebt, { gameId });

    const result = await t.run(async (ctx) => ({
      game: await ctx.db.get(gameId),
      player: await ctx.db.get(playerId),
      owner: await ctx.db.get(otherPlayerId),
    }));
    expect(result.player?.money).toBe(97);
    expect(result.owner?.money).toBe(1_004);
    expect(result.game).toMatchObject({ turn: 0, phase: "roll", doublesCount: 1 });
  });

  it("still sends the player to jail on the third consecutive doubles", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { t, asAlice, gameId, playerId } = await gameBeforeDoubles({ doublesCount: 2 });

    await asAlice.mutation(api.game.roll, { gameId });

    const result = await t.run(async (ctx) => ({
      game: await ctx.db.get(gameId),
      player: await ctx.db.get(playerId),
    }));
    expect(result.player).toMatchObject({ position: 10, inJail: true, jailTurns: 0 });
    expect(result.game).toMatchObject({ turn: 1, phase: "roll", doublesCount: 0 });
  });
});
