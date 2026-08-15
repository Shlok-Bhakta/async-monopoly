import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

async function gameBeforeRent() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const renterUserId = await ctx.db.insert("users", { name: "Alice" });
    const ownerUserId = await ctx.db.insert("users", { name: "Bob" });
    const gameId = await ctx.db.insert("games", {
      name: "Monopoly rent acceptance",
      code: "RENT05",
      status: "playing",
      createdBy: renterUserId,
      createdAt: 1,
      startedAt: 1,
      turn: 0,
      phase: "roll",
      phaseData: {},
      doublesCount: 0,
      lastActionAt: 1,
      seed: 1,
    });
    const renterId = await ctx.db.insert("players", {
      gameId,
      userId: renterUserId,
      seatIndex: 0,
      token: "Car",
      name: "Alice",
      money: 1_000,
      position: 37,
      inJail: false,
      jailTurns: 0,
      getOutOfJailCards: 0,
      bankrupt: false,
      properties: [],
      houses: [],
      mortgaged: [],
      joinedAt: 1,
    });
    const ownerId = await ctx.db.insert("players", {
      gameId,
      userId: ownerUserId,
      seatIndex: 1,
      token: "Dog",
      name: "Bob",
      money: 1_000,
      position: 0,
      inJail: false,
      jailTurns: 0,
      getOutOfJailCards: 0,
      bankrupt: false,
      properties: [1, 3, 37, 39],
      houses: [],
      mortgaged: [],
      joinedAt: 1,
    });
    return { renterUserId, gameId, renterId, ownerId };
  });

  return { t, ...ids, asRenter: t.withIdentity({ subject: ids.renterUserId }) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("classic monopoly rent", () => {
  it("doubles base rent on an unimproved property in its completed color set", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // 1 + 1 moves Alice to Boardwalk.
    const { t, asRenter, gameId, renterId, ownerId } = await gameBeforeRent();

    await asRenter.mutation(api.game.roll, { gameId });

    const result = await t.run(async (ctx) => ({
      renter: await ctx.db.get(renterId),
      owner: await ctx.db.get(ownerId),
    }));
    expect(result.renter?.money).toBe(900);
    expect(result.owner?.money).toBe(1_100);
  });
});
