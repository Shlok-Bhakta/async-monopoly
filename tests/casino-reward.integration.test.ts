import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { SPACES } from "../convex/monopoly/board";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

async function gameApproachingCasino() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Alice" });
    const otherUserId = await ctx.db.insert("users", { name: "Bob" });
    const gameId = await ctx.db.insert("games", {
      name: "Casino reward test",
      code: "CASINO",
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
      position: 18,
      inJail: false,
      jailTurns: 0,
      getOutOfJailCards: 0,
      bankrupt: false,
      properties: [3],
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
      properties: [1],
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

describe("Casino landing reward", () => {
  it("awards the first unowned deed in board order and explains it in the game log", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // 1 + 1 moves from 18 to Casino.
    const { t, asAlice, gameId, playerId } = await gameApproachingCasino();

    await asAlice.mutation(api.game.roll, { gameId });

    const result = await t.run(async (ctx) => ({
      player: await ctx.db.get(playerId),
      events: await ctx.db
        .query("events")
        .withIndex("by_game", (q) => q.eq("gameId", gameId))
        .collect(),
    }));
    expect(result.player?.properties).toEqual([3, 5]);
    expect(result.player?.money).toBe(1_000);
    expect(result.events.map((event) => event.message)).toContain(
      "Alice landed on the Casino and won Reading Railroad, the first unowned property in board order!",
    );
  });

  it("falls back to a $200 prize when every deed is owned and explains why", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // 1 + 1 moves from 18 to Casino.
    const { t, asAlice, gameId, playerId, otherPlayerId } = await gameApproachingCasino();
    const everyDeed = SPACES.filter((space) => space.price !== undefined).map((space) => space.index);
    await t.run((ctx) => ctx.db.patch(otherPlayerId, { properties: everyDeed }));

    await asAlice.mutation(api.game.roll, { gameId });

    const result = await t.run(async (ctx) => ({
      player: await ctx.db.get(playerId),
      events: await ctx.db
        .query("events")
        .withIndex("by_game", (q) => q.eq("gameId", gameId))
        .collect(),
    }));
    expect(result.player?.properties).toEqual([3]);
    expect(result.player?.money).toBe(1_200);
    expect(result.events.map((event) => event.message)).toContain(
      "Alice landed on the Casino and won $200 because every property is already owned!",
    );
  });
});
