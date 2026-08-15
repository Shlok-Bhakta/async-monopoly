import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

async function soloGameWithBots() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { name: "Alice" }));
  const asAlice = t.withIdentity({ subject: userId });
  const gameId = await asAlice.mutation(api.game.createGame, { name: "Solo bot game" });
  await asAlice.mutation(api.game.addBot, { gameId, playstyle: "balanced" });
  await asAlice.mutation(api.game.addBot, { gameId, playstyle: "aggressive" });
  return { t, userId, asAlice, gameId };
}

describe("deleting solo games with bots", () => {
  it("deletes a started game and every game-owned record", async () => {
    const { t, asAlice, gameId } = await soloGameWithBots();
    await asAlice.mutation(api.game.sendChatMessage, { gameId, message: "This will be deleted" });
    await t.run(async (ctx) => {
      const players = await ctx.db.query("players").withIndex("by_game", (q) => q.eq("gameId", gameId)).collect();
      await ctx.db.patch(gameId, { status: "playing", phase: "manage", startedAt: 2 });
      await ctx.db.insert("trades", {
        gameId,
        fromPlayerId: players[0]._id,
        toPlayerId: players[1]._id,
        fromCash: 0,
        fromProperties: [],
        toCash: 0,
        toProperties: [],
        status: "pending",
        createdAt: 2,
      });
      await ctx.db.insert("auctions", {
        gameId,
        spaceIndex: 1,
        currentBid: 0,
        order: players.map((player) => player._id),
        nextIndex: 0,
        status: "active",
        createdAt: 2,
      });
    });

    await asAlice.mutation(api.game.deleteGame, { gameId });

    const remaining = await t.run(async (ctx) => ({
      game: await ctx.db.get(gameId),
      players: await ctx.db.query("players").withIndex("by_game", (q) => q.eq("gameId", gameId)).collect(),
      events: await ctx.db.query("events").withIndex("by_game", (q) => q.eq("gameId", gameId)).collect(),
      chatMessages: await ctx.db.query("chatMessages").withIndex("by_game", (q) => q.eq("gameId", gameId)).collect(),
      trades: await ctx.db.query("trades").withIndex("by_game", (q) => q.eq("gameId", gameId)).collect(),
      auctions: await ctx.db.query("auctions").withIndex("by_game", (q) => q.eq("gameId", gameId)).collect(),
    }));
    expect(remaining).toEqual({ game: null, players: [], events: [], chatMessages: [], trades: [], auctions: [] });
  });

  it("marks a game as deletable when the signed-in player is the only human", async () => {
    const { asAlice } = await soloGameWithBots();

    const games = await asAlice.query(api.game.getMyGames, {});

    expect(games).toHaveLength(1);
    expect(games[0].canDelete).toBe(true);
  });

  it("refuses deletion while another human player is present", async () => {
    const { t, asAlice, gameId } = await soloGameWithBots();
    const bobId = await t.run((ctx) => ctx.db.insert("users", { name: "Bob" }));
    const code = await t.run(async (ctx) => (await ctx.db.get(gameId))!.code);
    await t.withIdentity({ subject: bobId }).mutation(api.game.joinGame, { code });

    await expect(asAlice.mutation(api.game.deleteGame, { gameId })).rejects.toThrow(
      "A game can only be deleted by its sole human player",
    );
    expect(await t.run((ctx) => ctx.db.get(gameId))).not.toBeNull();
    expect((await asAlice.query(api.game.getMyGames, {}))[0].canDelete).toBe(false);
  });

  it("cleans up all bots when the only human leaves a lobby", async () => {
    const { t, asAlice, gameId } = await soloGameWithBots();

    await asAlice.mutation(api.game.leaveGame, { gameId });

    expect(await t.run((ctx) => ctx.db.get(gameId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.query("players").withIndex("by_game", (q) => q.eq("gameId", gameId)).collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("events").withIndex("by_game", (q) => q.eq("gameId", gameId)).collect())).toEqual([]);
  });
});
