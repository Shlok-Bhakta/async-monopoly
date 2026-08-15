import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { SPACES, getSpace } from "../convex/monopoly/board";
import { CHANCE_DECK, COMMUNITY_CHEST_DECK } from "../convex/monopoly/cards";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

async function gameApproachingStockMarket() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Alice" });
    const otherUserId = await ctx.db.insert("users", { name: "Bob" });
    const gameId = await ctx.db.insert("games", {
      name: "Stock market test",
      code: "STOCKS",
      status: "playing",
      createdBy: userId,
      createdAt: 1,
      startedAt: 1,
      turn: 0,
      phase: "roll",
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
      position: 35,
      inJail: false,
      jailTurns: 0,
      getOutOfJailCards: 0,
      bankrupt: false,
      properties: [],
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
      properties: [],
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

describe("Stock Market board square", () => {
  it("replaces only Luxury Tax at space 38", () => {
    expect(SPACES).toHaveLength(40);
    expect(getSpace(38)).toMatchObject({
      index: 38,
      name: "Stock Market",
      type: "stockMarket",
    });
    expect(getSpace(38)).not.toHaveProperty("tax");

    expect(getSpace(4)).toMatchObject({ name: "Income Tax", type: "tax", tax: 200 });
    expect(getSpace(20)).toMatchObject({ name: "Casino", type: "casino" });
    expect(SPACES.filter((space) => space.name === "Luxury Tax")).toHaveLength(0);
  });
});

describe("Stock movement on rolls", () => {
  it("removes global market events from both card decks", () => {
    const effects = [...CHANCE_DECK, ...COMMUNITY_CHEST_DECK]
      .map((card) => card.effect)
      .filter((effect) => "type" in effect && (effect as any).type === "marketMove");
    expect(effects).toEqual([]);
  });

  it("moves only the rolling player's current holding by a random percentage", async () => {
    const { t, asAlice, gameId, playerId, otherPlayerId } = await gameApproachingStockMarket();
    await t.run(async (ctx) => {
      await ctx.db.patch(playerId, {
        position: 1,
        stockInvestment: 400,
        stockValue: 500,
      });
      await ctx.db.patch(otherPlayerId, {
        stockInvestment: 200,
        stockValue: 150,
      });
    });
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0); // -25% stock move after rolling 1 + 1.

    await asAlice.mutation(api.game.roll, { gameId });

    const result = await t.run(async (ctx) => ({
      alice: await ctx.db.get(playerId),
      bob: await ctx.db.get(otherPlayerId),
    }));
    expect(result.alice).toMatchObject({ money: 1_000, stockInvestment: 400, stockValue: 375 });
    expect(result.bob).toMatchObject({ money: 1_000, stockInvestment: 200, stockValue: 150 });
  });
});

describe("Stock Market landing", () => {
  it("initializes per-game market balances for a newly created player", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", { name: "Alice" }));
    const asAlice = t.withIdentity({ subject: userId });

    const gameId = await asAlice.mutation(api.game.createGame, { name: "Fresh market" });

    const player = await t.run((ctx) => ctx.db
      .query("players")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .unique());
    expect(player).toMatchObject({
      gameId,
      stockInvestment: 0,
      stockValue: 0,
    });
  });

  it("initializes per-game market balances for a joining player", async () => {
    const t = convexTest(schema, modules);
    const { aliceId, bobId } = await t.run(async (ctx) => ({
      aliceId: await ctx.db.insert("users", { name: "Alice" }),
      bobId: await ctx.db.insert("users", { name: "Bob" }),
    }));
    const gameId = await t.withIdentity({ subject: aliceId }).mutation(api.game.createGame, { name: "Join market" });
    const code = await t.run(async (ctx) => (await ctx.db.get(gameId))!.code);

    await t.withIdentity({ subject: bobId }).mutation(api.game.joinGame, { code });

    const bob = await t.run(async (ctx) => (await ctx.db
      .query("players")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect()).find((player) => player.userId === bobId));
    expect(bob).toMatchObject({
      gameId,
      stockInvestment: 0,
      stockValue: 0,
    });
  });

  it("offers an investment decision to a player with no position", async () => {
    const { t, asAlice, gameId } = await gameApproachingStockMarket();
    vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0.2); // 1 + 2 from 35.

    await asAlice.mutation(api.game.roll, { gameId });

    const game = await t.run((ctx) => ctx.db.get(gameId));
    expect(game?.phase).toBe("stockMarket");
    expect(game?.phaseData).toEqual({ investment: 0, value: 0 });
  });

  it("shows the player's persisted principal and current value on a later landing", async () => {
    const { t, asAlice, gameId, playerId } = await gameApproachingStockMarket();
    await t.run((ctx) => ctx.db.patch(playerId, { stockInvestment: 400, stockValue: 500 }));
    vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0.2).mockReturnValueOnce(0.99);

    await asAlice.mutation(api.game.roll, { gameId });

    const game = await t.run((ctx) => ctx.db.get(gameId));
    expect(game?.phaseData).toEqual({ investment: 400, value: 625 });
  });

  it("invests any chosen amount from the player's available cash", async () => {
    const { t, asAlice, gameId, playerId } = await gameApproachingStockMarket();
    vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0.2).mockReturnValueOnce(0);
    await asAlice.mutation(api.game.roll, { gameId });

    await asAlice.mutation(api.game.stockMarketAction, {
      gameId,
      action: "invest",
      amount: 600,
    });

    const result = await t.run(async (ctx) => ({
      game: await ctx.db.get(gameId),
      player: await ctx.db.get(playerId),
    }));
    expect(result.player?.money).toBe(400);
    expect(result.player?.stockInvestment).toBe(600);
    expect(result.player?.stockValue).toBe(600);
    expect(result.game?.phase).toBe("manage");
  });

  it("adds a later investment to both principal and current value", async () => {
    const { t, asAlice, gameId, playerId } = await gameApproachingStockMarket();
    await t.run((ctx) => ctx.db.patch(playerId, { stockInvestment: 400, stockValue: 500 }));
    vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0.2).mockReturnValueOnce(0);
    await asAlice.mutation(api.game.roll, { gameId });

    await asAlice.mutation(api.game.stockMarketAction, {
      gameId,
      action: "invest",
      amount: 200,
    });

    const player = await t.run((ctx) => ctx.db.get(playerId));
    expect(player?.money).toBe(800);
    expect(player?.stockInvestment).toBe(600);
    expect(player?.stockValue).toBe(575);
  });

  it("cashes out the current value away from the Stock Market space", async () => {
    const { t, asAlice, gameId, playerId } = await gameApproachingStockMarket();
    await t.run(async (ctx) => {
      await ctx.db.patch(playerId, { stockInvestment: 400, stockValue: 500 });
      await ctx.db.patch(gameId, { phase: "manage" });
    });

    await asAlice.mutation(api.game.stockMarketAction, {
      gameId,
      action: "cashOut",
    });

    const result = await t.run(async (ctx) => ({
      game: await ctx.db.get(gameId),
      player: await ctx.db.get(playerId),
    }));
    expect(result.player?.money).toBe(1_500);
    expect(result.player?.stockInvestment).toBe(0);
    expect(result.player?.stockValue).toBe(0);
    expect(result.game?.phase).toBe("manage");
  });

  it("rejects an investment above cash on hand without changing the player", async () => {
    const { t, asAlice, gameId, playerId } = await gameApproachingStockMarket();
    vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0.2);
    await asAlice.mutation(api.game.roll, { gameId });

    await expect(asAlice.mutation(api.game.stockMarketAction, {
      gameId,
      action: "invest",
      amount: 1_001,
    })).rejects.toThrow("Investment cannot exceed cash on hand");

    const player = await t.run((ctx) => ctx.db.get(playerId));
    expect(player?.money).toBe(1_000);
    expect(player?.stockInvestment).toBeUndefined();
    expect(player?.stockValue).toBeUndefined();
  });

  it("preserves a doubles bonus roll after the market decision", async () => {
    const { t, asAlice, gameId, playerId } = await gameApproachingStockMarket();
    await t.run((ctx) => ctx.db.patch(playerId, { position: 36 }));
    vi.spyOn(Math, "random").mockReturnValue(0); // 1 + 1 to Stock Market.
    await asAlice.mutation(api.game.roll, { gameId });

    await asAlice.mutation(api.game.stockMarketAction, {
      gameId,
      action: "invest",
      amount: 100,
    });

    const game = await t.run((ctx) => ctx.db.get(gameId));
    expect(game).toMatchObject({ turn: 0, phase: "roll", doublesCount: 1 });
  });

  it("lets a player with no cash skip without getting stuck", async () => {
    const { t, asAlice, gameId, playerId } = await gameApproachingStockMarket();
    await t.run((ctx) => ctx.db.patch(playerId, { money: 0 }));
    vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0.2);
    await asAlice.mutation(api.game.roll, { gameId });

    await asAlice.mutation(api.game.stockMarketAction, {
      gameId,
      action: "pass",
    });

    const game = await t.run((ctx) => ctx.db.get(gameId));
    expect(game?.phase).toBe("manage");
  });
});
