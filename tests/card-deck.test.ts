import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { CHANCE_DECK, COMMUNITY_CHEST_DECK, drawCard, shuffleDeck } from "../convex/monopoly/cards";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

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
});
