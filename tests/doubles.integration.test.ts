import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { CHANCE_DECK } from "../convex/monopoly/cards";
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
    return { userId, otherUserId, gameId, playerId, otherPlayerId };
  });

  return {
    t,
    ...ids,
    asAlice: t.withIdentity({ subject: ids.userId }),
    asBob: t.withIdentity({ subject: ids.otherUserId }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("doubles bonus roll", () => {
  it("returns directly to roll after a jail-escape doubles landing resolves", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.8); // 5 + 5 moves from Jail to the Casino.
    const { t, asAlice, gameId, playerId } = await gameBeforeDoubles({ alicePosition: 10 });
    await t.run(async (ctx) => {
      await ctx.db.patch(playerId, { inJail: true, jailTurns: 1 });
      await ctx.db.patch(gameId, { phase: "jail" });
    });

    await asAlice.mutation(api.game.jailAction, { gameId, action: "roll" });

    const result = await t.run(async (ctx) => ({
      game: await ctx.db.get(gameId),
      player: await ctx.db.get(playerId),
    }));
    expect(result.player).toMatchObject({ position: 20, inJail: false });
    expect(result.game).toMatchObject({ turn: 0, phase: "roll", doublesCount: 1 });
  });

  it("remains available after doubles release the player from jail and the landing resolves", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // 1 + 1 moves from Jail to Electric Company.
    const { t, asAlice, gameId, playerId } = await gameBeforeDoubles({ alicePosition: 10 });
    await t.run(async (ctx) => {
      await ctx.db.patch(playerId, { inJail: true, jailTurns: 1 });
      await ctx.db.patch(gameId, { phase: "jail" });
    });

    await asAlice.mutation(api.game.jailAction, { gameId, action: "roll" });
    await asAlice.mutation(api.game.buyProperty, { gameId });

    const result = await t.run(async (ctx) => ({
      game: await ctx.db.get(gameId),
      player: await ctx.db.get(playerId),
    }));
    expect(result.player).toMatchObject({ position: 12, inJail: false, properties: [12] });
    expect(result.game).toMatchObject({ turn: 0, phase: "roll", doublesCount: 1 });
  });

  it("remains available after jail-escape doubles lead to a debt that is settled", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99); // 6 + 6 moves from Jail to Chance.
    const { t, asAlice, gameId, playerId } = await gameBeforeDoubles({ aliceMoney: 1, alicePosition: 10 });
    const payCard = CHANCE_DECK.findIndex((card) => card.text === "Speeding fine $15.");
    await t.run(async (ctx) => {
      await ctx.db.patch(playerId, { inJail: true, jailTurns: 1 });
      await ctx.db.patch(gameId, { phase: "jail", chanceDeck: [payCard] });
    });

    await asAlice.mutation(api.game.jailAction, { gameId, action: "roll" });
    expect(await t.run((ctx) => ctx.db.get(gameId))).toMatchObject({ phase: "debt", doublesCount: 1 });

    await t.run((ctx) => ctx.db.patch(playerId, { money: 15 }));
    await asAlice.mutation(api.game.settleDebt, { gameId });

    expect(await t.run((ctx) => ctx.db.get(gameId))).toMatchObject({
      turn: 0,
      phase: "roll",
      doublesCount: 1,
    });
  });

  it("still ends the turn when the jail-escape doubles landing sends the player back to jail", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99); // 6 + 6 moves from Jail to Chance.
    const { t, asAlice, gameId, playerId } = await gameBeforeDoubles({ alicePosition: 10 });
    const goToJailCard = CHANCE_DECK.findIndex((card) => card.text.startsWith("Go to Jail."));
    await t.run(async (ctx) => {
      await ctx.db.patch(playerId, { inJail: true, jailTurns: 1, jailVisits: 1 });
      await ctx.db.patch(gameId, { phase: "jail", chanceDeck: [goToJailCard] });
    });

    await asAlice.mutation(api.game.jailAction, { gameId, action: "roll" });

    expect(await t.run((ctx) => ctx.db.get(playerId))).toMatchObject({
      position: 10,
      inJail: true,
      jailTurns: 0,
      jailVisits: 2,
    });
    expect(await t.run((ctx) => ctx.db.get(gameId))).toMatchObject({
      turn: 1,
      phase: "roll",
      doublesCount: 0,
    });
  });

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

  it("remains available after an auction triggered by doubles sells the property", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // 1 + 1 moves from 1 to Baltic Avenue.
    const { t, asAlice, asBob, gameId, otherPlayerId } = await gameBeforeDoubles();

    await asAlice.mutation(api.game.roll, { gameId });
    await asAlice.mutation(api.game.declineBuy, { gameId });
    await asBob.mutation(api.game.auctionBid, { gameId, amount: 10 });
    await asAlice.mutation(api.game.auctionPass, { gameId });

    const result = await t.run(async (ctx) => ({
      game: await ctx.db.get(gameId),
      winner: await ctx.db.get(otherPlayerId),
    }));
    expect(result.winner).toMatchObject({ money: 990, properties: [3] });
    expect(result.game).toMatchObject({ turn: 0, phase: "roll", doublesCount: 1 });
  });

  it("remains available after an auction triggered by doubles receives no bids", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // 1 + 1 moves from 1 to Baltic Avenue.
    const { t, asAlice, asBob, gameId } = await gameBeforeDoubles();

    await asAlice.mutation(api.game.roll, { gameId });
    await asAlice.mutation(api.game.declineBuy, { gameId });
    await asBob.mutation(api.game.auctionPass, { gameId });
    await asAlice.mutation(api.game.auctionPass, { gameId });

    const result = await t.run(async (ctx) => ({
      game: await ctx.db.get(gameId),
      players: await ctx.db.query("players").withIndex("by_game", (q) => q.eq("gameId", gameId)).collect(),
      auction: await ctx.db.query("auctions").withIndex("by_game", (q) => q.eq("gameId", gameId)).unique(),
    }));
    expect(result.players.every((player) => !player.properties.includes(3))).toBe(true);
    expect(result.auction).toMatchObject({ status: "done", winningBid: 0 });
    expect(result.game).toMatchObject({ turn: 0, phase: "roll", doublesCount: 1 });
  });

  it("still returns to manage after a non-doubles auction settles", async () => {
    const { t, asAlice, asBob, gameId } = await gameBeforeDoubles({ alicePosition: 0 });
    vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0.2); // 1 + 2 lands on Baltic Avenue.

    await asAlice.mutation(api.game.roll, { gameId });
    await asAlice.mutation(api.game.declineBuy, { gameId });
    await asBob.mutation(api.game.auctionPass, { gameId });
    await asAlice.mutation(api.game.auctionPass, { gameId });

    expect(await t.run((ctx) => ctx.db.get(gameId))).toMatchObject({
      turn: 0,
      phase: "manage",
      doublesCount: 0,
    });
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
