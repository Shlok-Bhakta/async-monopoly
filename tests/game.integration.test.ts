import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

async function playingGame(phase = "roll") {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Alice" });
    const otherUserId = await ctx.db.insert("users", { name: "Bob" });
    const gameId = await ctx.db.insert("games", {
      name: "Mortgage test",
      code: "MORT01",
      status: "playing",
      createdBy: userId,
      createdAt: 1,
      startedAt: 1,
      turn: 0,
      phase,
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
      money: 1_000,
      position: 0,
      inJail: false,
      jailTurns: 0,
      getOutOfJailCards: 0,
      bankrupt: false,
      properties: [1, 5, 12],
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
      properties: [3],
      houses: [],
      mortgaged: [],
      joinedAt: 1,
    });
    return { userId, otherUserId, gameId, playerId, otherPlayerId };
  });

  return {
    t,
    ...ids,
    asAlice: t.withIdentity({ subject: ids.userId }),
    asBob: t.withIdentity({ subject: ids.otherUserId }),
  };
}

describe("mortgage", () => {
  it("lets the turn player mortgage an owned deed before rolling", async () => {
    const { t, asAlice, gameId, playerId } = await playingGame("roll");

    await asAlice.mutation(api.game.mortgage, { gameId, space: 5 });

    const player = await t.run((ctx) => ctx.db.get(playerId));
    expect(player?.mortgaged).toEqual([5]);
    expect(player?.money).toBe(1_100);
    await expect(asAlice.mutation(api.game.mortgage, { gameId, space: 5 })).rejects.toThrow("Already mortgaged");
  });

  it("does not let a player mortgage outside their turn", async () => {
    const { asBob, gameId } = await playingGame("roll");

    await expect(asBob.mutation(api.game.mortgage, { gameId, space: 3 })).rejects.toThrow("Not your turn");
  });

  it("does not allow mortgages before the game starts", async () => {
    const { t, asAlice, gameId } = await playingGame("lobby");
    await t.run((ctx) => ctx.db.patch(gameId, { status: "lobby" }));

    await expect(asAlice.mutation(api.game.mortgage, { gameId, space: 1 })).rejects.toThrow("Game not in progress");
  });

  it("keeps unmortgaging at mortgage value plus 10% interest", async () => {
    const { t, asAlice, gameId, playerId } = await playingGame("manage");
    await asAlice.mutation(api.game.mortgage, { gameId, space: 12 });

    await asAlice.mutation(api.game.unmortgage, { gameId, space: 12 });

    const player = await t.run((ctx) => ctx.db.get(playerId));
    expect(player?.mortgaged).toEqual([]);
    expect(player?.money).toBe(992); // $1,000 + $75 mortgage - $83 payoff.
  });
});

describe("trading mortgaged property", () => {
  it("rejects a mortgaged deed when the offer is created", async () => {
    const { asAlice, gameId, otherPlayerId } = await playingGame("roll");
    await asAlice.mutation(api.game.mortgage, { gameId, space: 5 });

    await expect(asAlice.mutation(api.game.sendTrade, {
      gameId,
      toPlayerId: otherPlayerId,
      fromCash: 0,
      fromProperties: [5],
      toCash: 0,
      toProperties: [],
    })).rejects.toThrow("Unmortgage properties before trading");
  });

  it("rejects a pending offer if the sender mortgages an offered deed", async () => {
    const { t, asAlice, asBob, gameId, otherPlayerId } = await playingGame("roll");
    await asAlice.mutation(api.game.sendTrade, {
      gameId,
      toPlayerId: otherPlayerId,
      fromCash: 0,
      fromProperties: [5],
      toCash: 0,
      toProperties: [3],
    });
    const tradeId = await t.run(async (ctx) => {
      const trade = await ctx.db.query("trades").withIndex("by_game", (q) => q.eq("gameId", gameId)).unique();
      return trade!._id;
    });
    await asAlice.mutation(api.game.mortgage, { gameId, space: 5 });

    await expect(asBob.mutation(api.game.respondTrade, { tradeId, accept: true })).rejects.toThrow(
      "Offer no longer valid (property mortgaged)",
    );
  });

  it("rejects a pending offer if the recipient mortgages an offered deed", async () => {
    const { t, asAlice, asBob, gameId, otherPlayerId } = await playingGame("roll");
    await asAlice.mutation(api.game.sendTrade, {
      gameId,
      toPlayerId: otherPlayerId,
      fromCash: 0,
      fromProperties: [5],
      toCash: 0,
      toProperties: [3],
    });
    const tradeId = await t.run(async (ctx) => {
      const trade = await ctx.db.query("trades").withIndex("by_game", (q) => q.eq("gameId", gameId)).unique();
      await ctx.db.patch(gameId, { turn: 1 });
      return trade!._id;
    });
    await asBob.mutation(api.game.mortgage, { gameId, space: 3 });

    await expect(asBob.mutation(api.game.respondTrade, { tradeId, accept: true })).rejects.toThrow(
      "Offer no longer valid (property mortgaged)",
    );
  });
});
