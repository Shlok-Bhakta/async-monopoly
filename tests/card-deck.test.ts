import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { CHANCE_DECK, COMMUNITY_CHEST_DECK, drawCard, shuffleDeck } from "../convex/monopoly/cards";
import { rollDice } from "../convex/monopoly/engine";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

async function gameApproachingCardSpace(
  position: number,
  deckState: {
    chanceDeck?: number[];
    communityChestDeck?: number[];
    lastChanceCard?: number;
    lastCommunityChestCard?: number;
  } = {},
) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Alice" });
    const gameId = await ctx.db.insert("games", {
      name: "Persisted deck test",
      code: "DECK17",
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
      ...deckState,
    });
    const playerId = await ctx.db.insert("players", {
      gameId,
      userId,
      seatIndex: 0,
      token: "Car",
      name: "Alice",
      money: 1_000,
      position,
      inJail: false,
      jailTurns: 0,
      getOutOfJailCards: 0,
      bankrupt: false,
      properties: [],
      houses: [],
      mortgaged: [],
      joinedAt: 1,
    });
    return { userId, gameId, playerId };
  });

  return { t, ...ids, asAlice: t.withIdentity({ subject: ids.userId }) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("shuffleDeck", () => {
  it("Fisher-Yates shuffles every card into a per-deck draw order", () => {
    const random = vi.fn()
      .mockReturnValueOnce(0.5)
      .mockReturnValueOnce(0.25)
      .mockReturnValueOnce(0.75);

    expect(shuffleDeck(4, random)).toEqual([3, 1, 0, 2]);
    expect(random).toHaveBeenCalledTimes(3);
  });
});

describe("drawCard", () => {
  it("draws without replacement by removing the card from the live deck", () => {
    expect(drawCard(4, [0, 2], 1)).toEqual({
      cardIndex: 2,
      remaining: [0],
    });
  });

  it("reshuffles an exhausted deck and continues drawing", () => {
    const random = vi.fn()
      .mockReturnValueOnce(0.5)
      .mockReturnValueOnce(0.25)
      .mockReturnValueOnce(0.75);

    expect(drawCard(4, [], undefined, random)).toEqual({
      cardIndex: 2,
      remaining: [3, 1, 0],
    });
  });

  it("does not repeat the previous card at a reshuffle boundary", () => {
    const random = vi.fn()
      .mockReturnValueOnce(0.5)
      .mockReturnValueOnce(0.25)
      .mockReturnValueOnce(0.75)
      .mockReturnValueOnce(0.5);

    expect(drawCard(4, [], 2, random)).toEqual({
      cardIndex: 1,
      remaining: [3, 2, 0],
    });
  });
});

describe("per-game card decks", () => {
  it("persists complete Fisher-Yates shuffled decks when a game is created", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert("users", { name: "Alice" }));

    const gameId = await t.withIdentity({ subject: userId }).mutation(api.game.createGame, {
      name: "Shuffled decks",
    });

    const game = await t.run((ctx) => ctx.db.get(gameId));
    expect(game?.chanceDeck).toHaveLength(CHANCE_DECK.length);
    expect([...game!.chanceDeck!].sort((a, b) => a - b)).toEqual(
      CHANCE_DECK.map((_, index) => index),
    );
    expect(game?.communityChestDeck).toHaveLength(COMMUNITY_CHEST_DECK.length);
    expect([...game!.communityChestDeck!].sort((a, b) => a - b)).toEqual(
      COMMUNITY_CHEST_DECK.map((_, index) => index),
    );
  });

  it("persists Chance draws without replacement across separate roll mutations", async () => {
    const chanceDeck = [13, 5];
    const communityChestDeck = [2, 1];
    const { t, asAlice, gameId, playerId } = await gameApproachingCardSpace(5, {
      chanceDeck,
      communityChestDeck,
    });
    vi.spyOn(Math, "random").mockReturnValue(0); // Roll 1 + 1 onto Chance.

    await asAlice.mutation(api.game.roll, { gameId });
    let state = await t.run(async (ctx) => ({
      game: await ctx.db.get(gameId),
      player: await ctx.db.get(playerId),
    }));
    expect(state.game).toMatchObject({
      chanceDeck: [13],
      communityChestDeck,
      lastChanceCard: 5,
    });
    expect(state.player?.money).toBe(1_050);

    await t.run((ctx) => ctx.db.patch(playerId, { position: 5 }));
    await asAlice.mutation(api.game.roll, { gameId });
    state = await t.run(async (ctx) => ({
      game: await ctx.db.get(gameId),
      player: await ctx.db.get(playerId),
    }));
    expect(state.game).toMatchObject({
      chanceDeck: [],
      communityChestDeck,
      lastChanceCard: 13,
    });
    expect(state.player?.money).toBe(1_200);
  });

  it("persists Community Chest draws independently from the Chance deck", async () => {
    const chanceDeck = [9, 8];
    const { t, asAlice, gameId, playerId } = await gameApproachingCardSpace(15, {
      chanceDeck,
      communityChestDeck: [3],
    });
    vi.spyOn(Math, "random").mockReturnValue(0); // Roll 1 + 1 onto Community Chest.

    await asAlice.mutation(api.game.roll, { gameId });

    const state = await t.run(async (ctx) => ({
      game: await ctx.db.get(gameId),
      player: await ctx.db.get(playerId),
    }));
    expect(state.game).toMatchObject({
      chanceDeck,
      communityChestDeck: [],
      lastCommunityChestCard: 3,
    });
    expect(state.player?.money).toBe(1_050);
  });

  it("lazily reshuffles an exhausted legacy deck without repeating its last card", async () => {
    const { t, asAlice, gameId } = await gameApproachingCardSpace(5, {
      lastChanceCard: 0,
    });
    vi.spyOn(Math, "random").mockReturnValue(0);

    await asAlice.mutation(api.game.roll, { gameId });

    const game = await t.run((ctx) => ctx.db.get(gameId));
    expect(game?.lastChanceCard).toBe(1);
    expect(game?.chanceDeck).toHaveLength(CHANCE_DECK.length - 1);
    expect(game?.chanceDeck).toEqual(expect.arrayContaining([0]));
  });
});

describe("dice rolls", () => {
  it("remain independently uniform over values one through six", () => {
    const random = vi.spyOn(Math, "random")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.999_999);

    expect(rollDice()).toEqual([1, 6]);
    expect(random).toHaveBeenCalledTimes(2);
  });
});
