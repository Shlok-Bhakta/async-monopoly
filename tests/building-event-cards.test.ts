import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { CHANCE_DECK, COMMUNITY_CHEST_DECK } from "../convex/monopoly/cards";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

function cardIndex(deck: typeof CHANCE_DECK, text: string): number {
  const index = deck.findIndex((card) => card.text === text);
  if (index < 0) throw new Error(`Card not found: ${text}`);
  return index;
}

const NEW_BUILDING_CARDS = [
  {
    text: "Storm damage! Pay $30 for each house and $125 for each hotel.",
    effect: { type: "repairs", perHouse: 30, perHotel: 125 },
  },
  {
    text: "Your properties win city beautification awards. Collect $25 for each house and $100 for each hotel.",
    effect: { type: "buildingWindfall", perHouse: 25, perHotel: 100 },
  },
  {
    text: "Local housing grants are approved. Collect $40 for each house and $150 for each hotel.",
    effect: { type: "buildingWindfall", perHouse: 40, perHotel: 150 },
  },
];

const LEGACY_CARD_FINGERPRINTS = [
  ...CHANCE_DECK.slice(0, 16),
  ...COMMUNITY_CHEST_DECK.slice(0, 16),
].map(({ text, effect }) => `${text}|${JSON.stringify(effect)}`);

const EXPECTED_LEGACY_CARD_FINGERPRINTS = [
  "Advance to Go. Collect $200.|{\"type\":\"moveTo\",\"space\":0,\"collectOnPass\":true}",
  "Advance to Illinois Avenue.|{\"type\":\"moveTo\",\"space\":24}",
  "Advance to St. Charles Place.|{\"type\":\"moveTo\",\"space\":11}",
  "Advance to nearest Utility. If unowned, you may buy it from the Bank. If owned, throw dice and pay owner ten times the amount shown.|{\"type\":\"nearestUtility\"}",
  "Advance to the nearest Railroad. If unowned, you may buy it from the Bank. If owned, pay owner twice the rental to which they are otherwise entitled.|{\"type\":\"nearestRailroad\"}",
  "Bank pays you dividend of $50.|{\"type\":\"collect\",\"amount\":50}",
  "Go to Jail. Go directly to Jail. Do not pass GO, do not collect $200.|{\"type\":\"goToJail\"}",
  "Go back three spaces.|{\"type\":\"moveRelative\",\"spaces\":-3}",
  "Make general repairs on all your property: pay $25 for each house and $100 for each hotel.|{\"type\":\"repairs\",\"perHouse\":25,\"perHotel\":100}",
  "Speeding fine $15.|{\"type\":\"pay\",\"amount\":15}",
  "Take a trip to Reading Railroad. If you pass GO, collect $200.|{\"type\":\"moveTo\",\"space\":5,\"collectOnPass\":true}",
  "Advance to Boardwalk.|{\"type\":\"moveTo\",\"space\":39}",
  "You have been elected Chairman of the Board. Pay each player $50.|{\"type\":\"payEachPlayer\",\"amount\":50}",
  "Your building loan matures. Collect $150.|{\"type\":\"collect\",\"amount\":150}",
  "You have won a crossword competition. Collect $100.|{\"type\":\"collect\",\"amount\":100}",
  "The market surges! Every investment gains 25% of its principal.|{\"type\":\"marketMove\",\"percent\":25}",
  "Advance to Go. Collect $200.|{\"type\":\"moveTo\",\"space\":0,\"collectOnPass\":true}",
  "Bank error in your favor. Collect $200.|{\"type\":\"collect\",\"amount\":200}",
  "Doctor's fees. Pay $50.|{\"type\":\"pay\",\"amount\":50}",
  "From sale of stock you get $50.|{\"type\":\"collect\",\"amount\":50}",
  "Get Out of Jail Free. This card may be kept until needed or sold.|{\"type\":\"jailFree\"}",
  "Go to Jail. Go directly to Jail. Do not pass GO, do not collect $200.|{\"type\":\"goToJail\"}",
  "Grand Opera Night. Collect $50.|{\"type\":\"collect\",\"amount\":50}",
  "Holiday fund matures. Collect $100.|{\"type\":\"collect\",\"amount\":100}",
  "Income tax refund. Collect $20.|{\"type\":\"collect\",\"amount\":20}",
  "Life insurance matures. Collect $100.|{\"type\":\"collect\",\"amount\":100}",
  "Pay hospital fees of $100.|{\"type\":\"pay\",\"amount\":100}",
  "Pay school fees of $150.|{\"type\":\"pay\",\"amount\":150}",
  "Receive $25 consultancy fee.|{\"type\":\"collect\",\"amount\":25}",
  "You are assessed for street repairs: pay $40 for each house and $115 for each hotel.|{\"type\":\"repairs\",\"perHouse\":40,\"perHotel\":115}",
  "You have won second prize in a beauty contest. Collect $10.|{\"type\":\"collect\",\"amount\":10}",
  "The market slumps. Every investment loses 25% of its principal.|{\"type\":\"marketMove\",\"percent\":-25}",
];

async function gameApproachingCardSpace(position: number) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Alice" });
    const gameId = await ctx.db.insert("games", {
      name: "Building card test",
      code: "BUILD8",
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
      position,
      inJail: false,
      jailTurns: 0,
      getOutOfJailCards: 0,
      bankrupt: false,
      properties: [1, 3],
      houses: [{ space: 1, count: 2 }, { space: 3, count: 5 }],
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

describe("building-related event card decks", () => {
  it("adds three building cards without changing any legacy card", () => {
    expect(LEGACY_CARD_FINGERPRINTS).toEqual(EXPECTED_LEGACY_CARD_FINGERPRINTS);
    expect(CHANCE_DECK).toHaveLength(18);
    expect(COMMUNITY_CHEST_DECK).toHaveLength(17);
    expect([...CHANCE_DECK, ...COMMUNITY_CHEST_DECK]).toEqual(
      expect.arrayContaining(NEW_BUILDING_CARDS),
    );
  });

  it("deals and renders the storm repair card with separate house and hotel costs", async () => {
    const { t, asAlice, gameId, playerId } = await gameApproachingCardSpace(4);
    await t.run((ctx) => ctx.db.patch(gameId, {
      chanceDeck: [cardIndex(CHANCE_DECK, "Storm damage! Pay $30 for each house and $125 for each hotel.")],
    }));
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.2); // Roll 1 + 2 onto Chance.

    await asAlice.mutation(api.game.roll, { gameId });

    const result = await t.run(async (ctx) => ({
      player: await ctx.db.get(playerId),
      game: await ctx.db.get(gameId),
      events: await ctx.db.query("events").withIndex("by_game", (q) => q.eq("gameId", gameId)).collect(),
    }));
    expect(result.player?.money).toBe(815); // 2 houses × $30 + 1 hotel × $125.
    expect(result.game?.phase).toBe("manage");
    expect(result.events.map((event) => event.message)).toEqual(expect.arrayContaining([
      'Alice drew Chance: "Storm damage! Pay $30 for each house and $125 for each hotel."',
      "Alice paid $185 in repairs (2 houses, 1 hotel).",
    ]));
  });

  it("deals and renders the city beautification windfall from the Chance deck", async () => {
    const { t, asAlice, gameId, playerId } = await gameApproachingCardSpace(4);
    await t.run((ctx) => ctx.db.patch(gameId, {
      chanceDeck: [cardIndex(CHANCE_DECK, "Your properties win city beautification awards. Collect $25 for each house and $100 for each hotel.")],
    }));
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.2); // Roll 1 + 2 onto Chance.

    await asAlice.mutation(api.game.roll, { gameId });

    const result = await t.run(async (ctx) => ({
      player: await ctx.db.get(playerId),
      game: await ctx.db.get(gameId),
      events: await ctx.db.query("events").withIndex("by_game", (q) => q.eq("gameId", gameId)).collect(),
    }));
    expect(result.player?.money).toBe(1_150); // 2 houses × $25 + 1 hotel × $100.
    expect(result.game?.phase).toBe("manage");
    expect(result.events.map((event) => event.message)).toEqual(expect.arrayContaining([
      'Alice drew Chance: "Your properties win city beautification awards. Collect $25 for each house and $100 for each hotel."',
      "Alice collected $150 from 2 houses and 1 hotel.",
    ]));
  });

  it("deals the housing grant from Community Chest without awarding an empty portfolio", async () => {
    const { t, asAlice, gameId, playerId } = await gameApproachingCardSpace(14);
    await t.run(async (ctx) => {
      await ctx.db.patch(playerId, { properties: [], houses: [] });
      await ctx.db.patch(gameId, {
        communityChestDeck: [cardIndex(COMMUNITY_CHEST_DECK, "Local housing grants are approved. Collect $40 for each house and $150 for each hotel.")],
      });
    });
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.2); // Roll 1 + 2 onto Community Chest.

    await asAlice.mutation(api.game.roll, { gameId });

    const result = await t.run(async (ctx) => ({
      player: await ctx.db.get(playerId),
      game: await ctx.db.get(gameId),
      events: await ctx.db.query("events").withIndex("by_game", (q) => q.eq("gameId", gameId)).collect(),
    }));
    expect(result.player?.money).toBe(1_000);
    expect(result.game?.phase).toBe("manage");
    expect(result.events.map((event) => event.message)).toEqual(expect.arrayContaining([
      'Alice drew Community Chest: "Local housing grants are approved. Collect $40 for each house and $150 for each hotel."',
      "Alice owns no buildings — no windfall awarded.",
    ]));
  });
});
