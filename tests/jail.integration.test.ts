import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { CHANCE_DECK } from "../convex/monopoly/cards";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

function chanceRandom(text: string): number {
  const index = CHANCE_DECK.findIndex((card) => card.text === text);
  if (index < 0) throw new Error(`Chance card not found: ${text}`);
  return (index + 0.5) / CHANCE_DECK.length;
}

async function gameWithJailedOwner() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const aliceUserId = await ctx.db.insert("users", { name: "Alice" });
    const bobUserId = await ctx.db.insert("users", { name: "Bob" });
    const gameId = await ctx.db.insert("games", {
      name: "Jail acceptance test",
      code: "JAIL05",
      status: "playing",
      createdBy: aliceUserId,
      createdAt: 1,
      startedAt: 1,
      turn: 0,
      phase: "roll",
      phaseData: {},
      doublesCount: 0,
      lastActionAt: 1,
      seed: 1,
    });
    const alicePlayerId = await ctx.db.insert("players", {
      gameId,
      userId: aliceUserId,
      seatIndex: 0,
      token: "Car",
      name: "Alice",
      money: 1_000,
      position: 1,
      inJail: false,
      jailTurns: 0,
      getOutOfJailCards: 0,
      bankrupt: false,
      properties: [],
      houses: [],
      mortgaged: [],
      joinedAt: 1,
    });
    const bobPlayerId = await ctx.db.insert("players", {
      gameId,
      userId: bobUserId,
      seatIndex: 1,
      token: "Dog",
      name: "Bob",
      money: 1_000,
      position: 10,
      inJail: true,
      jailTurns: 0,
      getOutOfJailCards: 0,
      bankrupt: false,
      properties: [3],
      houses: [],
      mortgaged: [],
      joinedAt: 1,
    });
    return { aliceUserId, gameId, alicePlayerId, bobPlayerId };
  });

  return { t, ...ids, asAlice: t.withIdentity({ subject: ids.aliceUserId }) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("jail income", () => {
  it("does not pay rent to a property owner who is in jail", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // 1 + 1 moves Alice from 1 to Bob's Baltic Avenue.
    const { t, asAlice, gameId, alicePlayerId, bobPlayerId } = await gameWithJailedOwner();

    await asAlice.mutation(api.game.roll, { gameId });

    const result = await t.run(async (ctx) => ({
      alice: await ctx.db.get(alicePlayerId),
      bob: await ctx.db.get(bobPlayerId),
    }));
    expect(result.alice?.money).toBe(1_000);
    expect(result.bob?.money).toBe(1_000);
  });

  it("does not pay double railroad rent from a card to an owner who is in jail", async () => {
    const { t, asAlice, gameId, alicePlayerId, bobPlayerId } = await gameWithJailedOwner();
    await t.run(async (ctx) => {
      await ctx.db.patch(alicePlayerId, { position: 5 });
      await ctx.db.patch(bobPlayerId, { properties: [15] });
    });
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(chanceRandom("Advance to the nearest Railroad. If unowned, you may buy it from the Bank. If owned, pay owner twice the rental to which they are otherwise entitled."));

    await asAlice.mutation(api.game.roll, { gameId });

    const result = await t.run(async (ctx) => ({
      alice: await ctx.db.get(alicePlayerId),
      bob: await ctx.db.get(bobPlayerId),
    }));
    expect(result.alice?.money).toBe(1_000);
    expect(result.bob?.money).toBe(1_000);
  });

  it("does not pay card income to another player who is in jail", async () => {
    const { t, asAlice, gameId, alicePlayerId, bobPlayerId } = await gameWithJailedOwner();
    await t.run((ctx) => ctx.db.patch(alicePlayerId, { position: 5 }));
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(chanceRandom("You have been elected Chairman of the Board. Pay each player $50."));

    await asAlice.mutation(api.game.roll, { gameId });

    const result = await t.run(async (ctx) => ({
      alice: await ctx.db.get(alicePlayerId),
      bob: await ctx.db.get(bobPlayerId),
    }));
    expect(result.alice?.money).toBe(1_000);
    expect(result.bob?.money).toBe(1_000);
  });
});

describe("repeat-visit bail", () => {
  it("charges the standard $50 on the first visit and $100 on the second visit in the same game", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { t, asAlice, gameId, alicePlayerId } = await gameWithJailedOwner();

    await t.run((ctx) => ctx.db.patch(gameId, { doublesCount: 2 }));
    await asAlice.mutation(api.game.roll, { gameId });
    await t.run((ctx) => ctx.db.patch(gameId, { turn: 0, phase: "jail" }));
    await asAlice.mutation(api.game.jailAction, { gameId, action: "pay" });
    expect((await t.run((ctx) => ctx.db.get(alicePlayerId)))?.money).toBe(950);

    await t.run((ctx) => ctx.db.patch(gameId, { turn: 0, phase: "roll", doublesCount: 2 }));
    await asAlice.mutation(api.game.roll, { gameId });
    await t.run((ctx) => ctx.db.patch(gameId, { turn: 0, phase: "jail" }));
    await asAlice.mutation(api.game.jailAction, { gameId, action: "pay" });

    expect((await t.run((ctx) => ctx.db.get(alicePlayerId)))?.money).toBe(850);
  });

  it("uses the increased bail after the third failed doubles roll", async () => {
    const { t, asAlice, gameId, alicePlayerId } = await gameWithJailedOwner();
    await t.run(async (ctx) => {
      await ctx.db.patch(alicePlayerId, {
        position: 10,
        inJail: true,
        jailTurns: 2,
        jailVisits: 2,
      });
      await ctx.db.patch(gameId, { phase: "jail" });
    });
    vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0.2); // 1 + 2, not doubles.

    await asAlice.mutation(api.game.jailAction, { gameId, action: "roll" });

    expect(await t.run((ctx) => ctx.db.get(alicePlayerId))).toMatchObject({
      money: 900,
      inJail: false,
      jailTurns: 0,
      jailVisits: 2,
    });
  });

  it("requires the increased bail as debt when cash is short after the third failed roll", async () => {
    const { t, asAlice, gameId, alicePlayerId } = await gameWithJailedOwner();
    await t.run(async (ctx) => {
      await ctx.db.patch(alicePlayerId, {
        money: 75,
        position: 10,
        inJail: true,
        jailTurns: 2,
        jailVisits: 2,
      });
      await ctx.db.patch(gameId, { phase: "jail" });
    });
    vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0.2);

    await asAlice.mutation(api.game.jailAction, { gameId, action: "roll" });

    expect(await t.run((ctx) => ctx.db.get(gameId))).toMatchObject({
      phase: "debt",
      phaseData: { amount: 100, to: "bank", reason: "jail bail" },
    });

    await t.run((ctx) => ctx.db.patch(alicePlayerId, { money: 100 }));
    await asAlice.mutation(api.game.settleDebt, { gameId });

    expect(await t.run((ctx) => ctx.db.get(alicePlayerId))).toMatchObject({
      money: 0,
      inJail: false,
      jailTurns: 0,
      jailVisits: 2,
    });
  });

  it("counts visits caused by landing on Go To Jail", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { t, asAlice, gameId, alicePlayerId } = await gameWithJailedOwner();

    await t.run((ctx) => ctx.db.patch(alicePlayerId, { position: 28 }));
    await asAlice.mutation(api.game.roll, { gameId });
    await t.run((ctx) => ctx.db.patch(gameId, { turn: 0, phase: "jail" }));
    await asAlice.mutation(api.game.jailAction, { gameId, action: "pay" });

    await t.run(async (ctx) => {
      await ctx.db.patch(alicePlayerId, { position: 28 });
      await ctx.db.patch(gameId, { turn: 0, phase: "roll", doublesCount: 0 });
    });
    await asAlice.mutation(api.game.roll, { gameId });
    await t.run((ctx) => ctx.db.patch(gameId, { turn: 0, phase: "jail" }));
    await asAlice.mutation(api.game.jailAction, { gameId, action: "pay" });

    expect((await t.run((ctx) => ctx.db.get(alicePlayerId)))?.money).toBe(850);
  });

  it("counts visits caused by Go to Jail cards", async () => {
    const random = vi.spyOn(Math, "random");
    const { t, asAlice, gameId, alicePlayerId } = await gameWithJailedOwner();

    await t.run((ctx) => ctx.db.patch(alicePlayerId, { position: 5 }));
    random.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(chanceRandom("Go to Jail. Go directly to Jail. Do not pass GO, do not collect $200."));
    await asAlice.mutation(api.game.roll, { gameId });
    await t.run((ctx) => ctx.db.patch(gameId, { turn: 0, phase: "jail" }));
    await asAlice.mutation(api.game.jailAction, { gameId, action: "pay" });

    await t.run(async (ctx) => {
      await ctx.db.patch(alicePlayerId, { position: 5 });
      await ctx.db.patch(gameId, { turn: 0, phase: "roll", doublesCount: 0 });
    });
    random.mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(chanceRandom("Go to Jail. Go directly to Jail. Do not pass GO, do not collect $200."));
    await asAlice.mutation(api.game.roll, { gameId });
    await t.run((ctx) => ctx.db.patch(gameId, { turn: 0, phase: "jail" }));
    await asAlice.mutation(api.game.jailAction, { gameId, action: "pay" });

    expect((await t.run((ctx) => ctx.db.get(alicePlayerId)))?.money).toBe(850);
  });
});

describe("existing jail escape rules", () => {
  it("still releases a player who rolls doubles and moves them by that roll", async () => {
    const { t, asAlice, gameId, alicePlayerId } = await gameWithJailedOwner();
    await t.run(async (ctx) => {
      await ctx.db.patch(alicePlayerId, {
        position: 10,
        inJail: true,
        jailTurns: 1,
        jailVisits: 2,
      });
      await ctx.db.patch(gameId, { phase: "jail" });
    });
    vi.spyOn(Math, "random").mockReturnValue(0);

    await asAlice.mutation(api.game.jailAction, { gameId, action: "roll" });

    expect(await t.run((ctx) => ctx.db.get(alicePlayerId))).toMatchObject({
      position: 12,
      money: 1_000,
      inJail: false,
      jailTurns: 0,
      jailVisits: 2,
    });
    expect(await t.run((ctx) => ctx.db.get(gameId))).toMatchObject({ phase: "buy" });
  });

  it("still releases a player who uses a Get Out of Jail Free card", async () => {
    const { t, asAlice, gameId, alicePlayerId } = await gameWithJailedOwner();
    await t.run(async (ctx) => {
      await ctx.db.patch(alicePlayerId, {
        position: 10,
        inJail: true,
        jailTurns: 1,
        jailVisits: 2,
        getOutOfJailCards: 1,
      });
      await ctx.db.patch(gameId, { phase: "jail" });
    });

    await asAlice.mutation(api.game.jailAction, { gameId, action: "card" });

    expect(await t.run((ctx) => ctx.db.get(alicePlayerId))).toMatchObject({
      money: 1_000,
      inJail: false,
      jailTurns: 0,
      jailVisits: 2,
      getOutOfJailCards: 0,
    });
    expect(await t.run((ctx) => ctx.db.get(gameId))).toMatchObject({ phase: "roll" });
  });

  it("still keeps a player jailed after an early failed doubles roll", async () => {
    const { t, asAlice, gameId, alicePlayerId } = await gameWithJailedOwner();
    await t.run(async (ctx) => {
      await ctx.db.patch(alicePlayerId, {
        position: 10,
        inJail: true,
        jailTurns: 0,
        jailVisits: 2,
      });
      await ctx.db.patch(gameId, { phase: "jail" });
    });
    vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0.2);

    await asAlice.mutation(api.game.jailAction, { gameId, action: "roll" });

    expect(await t.run((ctx) => ctx.db.get(alicePlayerId))).toMatchObject({
      money: 1_000,
      inJail: true,
      jailTurns: 1,
      jailVisits: 2,
    });
    expect(await t.run((ctx) => ctx.db.get(gameId))).toMatchObject({ turn: 1, phase: "jail" });
  });
});
