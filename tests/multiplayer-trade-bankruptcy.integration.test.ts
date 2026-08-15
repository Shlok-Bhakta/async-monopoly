import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

async function threePlayerGame() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const aliceUserId = await ctx.db.insert("users", { name: "Alice" });
    const bobUserId = await ctx.db.insert("users", { name: "Bob" });
    const charlieUserId = await ctx.db.insert("users", { name: "Charlie" });
    const gameId = await ctx.db.insert("games", {
      name: "Three player test",
      code: "THREE1",
      status: "playing",
      createdBy: aliceUserId,
      createdAt: 1,
      startedAt: 1,
      turn: 0,
      phase: "manage",
      phaseData: {},
      doublesCount: 0,
      lastActionAt: 1,
      seed: 1,
    });
    const basePlayer = {
      gameId,
      position: 0,
      inJail: false,
      jailTurns: 0,
      getOutOfJailCards: 0,
      bankrupt: false,
      houses: [],
      mortgaged: [],
      stockInvestment: 0,
      stockValue: 0,
      joinedAt: 1,
    };
    const aliceId = await ctx.db.insert("players", {
      ...basePlayer,
      userId: aliceUserId,
      seatIndex: 0,
      token: "Car",
      name: "Alice",
      money: 1_000,
      properties: [1, 5],
    });
    const bobId = await ctx.db.insert("players", {
      ...basePlayer,
      userId: bobUserId,
      seatIndex: 1,
      token: "Dog",
      name: "Bob",
      money: 900,
      properties: [3],
    });
    const charlieId = await ctx.db.insert("players", {
      ...basePlayer,
      userId: charlieUserId,
      seatIndex: 2,
      token: "Hat",
      name: "Charlie",
      money: 700,
      properties: [6],
    });
    return { aliceUserId, bobUserId, charlieUserId, gameId, aliceId, bobId, charlieId };
  });

  return {
    t,
    ...ids,
    asAlice: t.withIdentity({ subject: ids.aliceUserId }),
    asCharlie: t.withIdentity({ subject: ids.charlieUserId }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("multiplayer trading", () => {
  it("sends and completes a trade with the selected player without affecting another player", async () => {
    const { t, asAlice, asCharlie, gameId, aliceId, bobId, charlieId } = await threePlayerGame();

    await asAlice.mutation(api.game.sendTrade, {
      gameId,
      toPlayerId: charlieId,
      fromCash: 100,
      fromProperties: [1],
      toCash: 50,
      toProperties: [6],
    });
    const tradeId = await t.run(async (ctx) => {
      const trade = await ctx.db.query("trades").withIndex("by_game", (q) => q.eq("gameId", gameId)).unique();
      expect(trade?.toPlayerId).toBe(charlieId);
      return trade!._id;
    });

    await asCharlie.mutation(api.game.respondTrade, { tradeId, accept: true });

    const result = await t.run(async (ctx) => ({
      alice: await ctx.db.get(aliceId),
      bob: await ctx.db.get(bobId),
      charlie: await ctx.db.get(charlieId),
    }));
    expect(result.alice).toMatchObject({ money: 950, properties: [5, 6] });
    expect(result.bob).toMatchObject({ money: 900, properties: [3] });
    expect(result.charlie).toMatchObject({ money: 750, properties: [1] });
  });
});

describe("bankruptcy to another player", () => {
  it("transfers all cash, deeds, mortgages, and stock to the creditor", async () => {
    const { t, asAlice, gameId, aliceId, charlieId } = await threePlayerGame();
    await t.run(async (ctx) => {
      await ctx.db.patch(aliceId, {
        money: 125,
        houses: [{ space: 1, count: 1 }],
        mortgaged: [5],
        stockInvestment: 300,
        stockValue: 360,
      });
      await ctx.db.patch(charlieId, { stockInvestment: 100, stockValue: 125 });
      await ctx.db.patch(gameId, {
        phase: "debt",
        phaseData: { amount: 500, to: charlieId, reason: "rent", nextPhase: "manage", space: 6 },
      });
    });

    await asAlice.mutation(api.game.declareBankruptcy, { gameId });

    const result = await t.run(async (ctx) => ({
      alice: await ctx.db.get(aliceId),
      charlie: await ctx.db.get(charlieId),
    }));
    expect(result.alice).toMatchObject({
      bankrupt: true,
      money: 0,
      properties: [],
      houses: [],
      mortgaged: [],
      stockInvestment: 0,
      stockValue: 0,
    });
    expect(result.charlie).toMatchObject({
      money: 850,
      properties: [6, 1, 5],
      mortgaged: [5],
      stockInvestment: 400,
      stockValue: 485,
    });
  });
});

describe("income tax", () => {
  it("creates a $150 bank debt when a player lands on Income Tax", async () => {
    const { t, asAlice, gameId, aliceId } = await threePlayerGame();
    await t.run(async (ctx) => {
      await ctx.db.patch(aliceId, { position: 1, money: 100 });
      await ctx.db.patch(gameId, { phase: "roll" });
    });
    vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0.2); // Roll 1 + 2.

    await asAlice.mutation(api.game.roll, { gameId });

    const game = await t.run((ctx) => ctx.db.get(gameId));
    expect(game).toMatchObject({
      phase: "debt",
      phaseData: { amount: 150, to: "bank", reason: "Income Tax", space: 4 },
    });
  });
});
