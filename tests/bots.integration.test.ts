import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

afterEach(() => vi.restoreAllMocks());

async function gameWithTradeBot() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { name: "Host" }));
  const host = t.withIdentity({ subject: userId });
  const gameId = await host.mutation(api.game.createGame, { name: "Bot trading" });
  await host.mutation(api.game.addBot, { gameId, playstyle: "balanced" });
  const players = await t.run((ctx) => ctx.db.query("players").withIndex("by_game", (q) => q.eq("gameId", gameId)).collect());
  const human = players.find((player) => !player.isBot)!;
  const bot = players.find((player) => player.isBot)!;
  await t.run(async (ctx) => {
    await ctx.db.patch(human._id, { properties: [1], money: 1_000 });
    await ctx.db.patch(bot._id, { properties: [3], money: 1_000 });
    await ctx.db.patch(gameId, { status: "playing", phase: "manage", turn: 0 });
  });
  return { t, host, gameId, humanId: human._id, botId: bot._id };
}

describe("test bots", () => {
  it("adds each playstyle to a lobby and lets a bot take its turn", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", { name: "Host" }));
    const host = t.withIdentity({ subject: userId });
    const gameId = await host.mutation(api.game.createGame, { name: "Bot lab" });

    await host.mutation(api.game.addBot, { gameId, playstyle: "conservative" });
    await host.mutation(api.game.addBot, { gameId, playstyle: "balanced" });
    await host.mutation(api.game.addBot, { gameId, playstyle: "aggressive" });

    const bots = await t.run(async (ctx) => (await ctx.db
      .query("players")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect()).filter((player) => player.isBot));
    expect(bots.map((bot) => bot.botPlaystyle)).toEqual(["conservative", "balanced", "aggressive"]);
    expect(bots.every((bot) => bot.userId === undefined)).toBe(true);

    await t.run(async (ctx) => {
      await ctx.db.patch(bots[0]._id, { position: 1 });
      await ctx.db.patch(gameId, { status: "playing", turn: 1, phase: "roll" });
    });
    vi.spyOn(Math, "random").mockReturnValue(0); // 1 + 1.
    await host.mutation(api.game.playBotStep, { gameId });

    expect(await t.run((ctx) => ctx.db.get(bots[0]._id))).toMatchObject({ position: 3 });
  });

  it("automatically accepts a fair property trade sent to a bot", async () => {
    const { t, host, gameId, humanId, botId } = await gameWithTradeBot();

    await host.mutation(api.game.sendTrade, {
      gameId,
      toPlayerId: botId,
      fromCash: 0,
      fromProperties: [1],
      toCash: 0,
      toProperties: [3],
    });

    const result = await t.run(async (ctx) => ({
      human: await ctx.db.get(humanId),
      bot: await ctx.db.get(botId),
      trade: await ctx.db.query("trades").withIndex("by_game", (q) => q.eq("gameId", gameId)).unique(),
    }));
    expect(result.human?.properties).toEqual([3]);
    expect(result.bot?.properties).toEqual([1]);
    expect(result.trade?.status).toBe("accepted");
  });

  it("automatically declines an unfavorable trade sent to a bot", async () => {
    const { t, host, gameId, humanId, botId } = await gameWithTradeBot();

    await host.mutation(api.game.sendTrade, {
      gameId,
      toPlayerId: botId,
      fromCash: 0,
      fromProperties: [],
      toCash: 100,
      toProperties: [3],
    });

    const result = await t.run(async (ctx) => ({
      human: await ctx.db.get(humanId),
      bot: await ctx.db.get(botId),
      trade: await ctx.db.query("trades").withIndex("by_game", (q) => q.eq("gameId", gameId)).unique(),
    }));
    expect(result.human).toMatchObject({ money: 1_000, properties: [1] });
    expect(result.bot).toMatchObject({ money: 1_000, properties: [3] });
    expect(result.trade?.status).toBe("declined");
  });
});
