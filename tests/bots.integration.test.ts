import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

afterEach(() => vi.restoreAllMocks());

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
});
