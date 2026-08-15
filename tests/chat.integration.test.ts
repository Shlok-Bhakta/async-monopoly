import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

async function twoPlayerGame() {
  const t = convexTest(schema, modules);
  const { aliceId, bobId, outsiderId } = await t.run(async (ctx) => ({
    aliceId: await ctx.db.insert("users", { name: "Alice" }),
    bobId: await ctx.db.insert("users", { name: "Bob" }),
    outsiderId: await ctx.db.insert("users", { name: "Mallory" }),
  }));
  const asAlice = t.withIdentity({ subject: aliceId });
  const asBob = t.withIdentity({ subject: bobId });
  const asOutsider = t.withIdentity({ subject: outsiderId });
  const gameId = await asAlice.mutation(api.game.createGame, { name: "Chat test" });
  const code = await t.run(async (ctx) => (await ctx.db.get(gameId))!.code);
  await asBob.mutation(api.game.joinGame, { code });
  return { t, asAlice, asBob, asOutsider, gameId };
}

describe("in-game chat", () => {
  it("stores trimmed messages and returns them to players in chronological order", async () => {
    const { t, asAlice, asBob, gameId } = await twoPlayerGame();

    await asAlice.mutation(api.game.sendChatMessage, { gameId, message: "  Ready to trade?  " });
    await asBob.mutation(api.game.sendChatMessage, { gameId, message: "Yes!" });
    await t.run(async (ctx) => {
      const messages = await ctx.db.query("chatMessages").withIndex("by_game", (q) => q.eq("gameId", gameId)).collect();
      for (const message of messages) await ctx.db.patch(message._id, { createdAt: message.playerName === "Alice" ? 100 : 200 });
    });

    const game = await asAlice.query(api.game.getGame, { gameId });
    expect(game.chatMessages.map((message) => ({
      playerName: message.playerName,
      message: message.message,
      createdAt: message.createdAt,
    }))).toEqual([
      { playerName: "Alice", message: "Ready to trade?", createdAt: 100 },
      { playerName: "Bob", message: "Yes!", createdAt: 200 },
    ]);
  });

  it("rejects empty and oversized messages", async () => {
    const { asAlice, gameId } = await twoPlayerGame();

    await expect(asAlice.mutation(api.game.sendChatMessage, { gameId, message: "   " })).rejects.toThrow("Message cannot be empty");
    await expect(asAlice.mutation(api.game.sendChatMessage, { gameId, message: "x".repeat(501) })).rejects.toThrow(
      "Message cannot exceed 500 characters",
    );
  });

  it("prevents non-players from sending or reading chat messages", async () => {
    const { asAlice, asOutsider, gameId } = await twoPlayerGame();
    await asAlice.mutation(api.game.sendChatMessage, { gameId, message: "Private table talk" });

    await expect(asOutsider.mutation(api.game.sendChatMessage, { gameId, message: "Let me in" })).rejects.toThrow(
      "You are not in this game",
    );
    const outsiderView = await asOutsider.query(api.game.getGame, { gameId });
    expect(outsiderView.chatMessages).toEqual([]);
  });

  it("closes chat after the game is finished", async () => {
    const { t, asAlice, gameId } = await twoPlayerGame();
    await t.run((ctx) => ctx.db.patch(gameId, { status: "finished", phase: "gameOver" }));

    await expect(asAlice.mutation(api.game.sendChatMessage, { gameId, message: "Good game" })).rejects.toThrow(
      "Chat is closed for finished games",
    );
  });
});
