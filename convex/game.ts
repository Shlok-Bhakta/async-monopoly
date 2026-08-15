import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  getSpace,
  isOnPropertySet,
  STARTING_MONEY,
  HOUSE_SUPPLY,
  HOTEL_SUPPLY,
  findNearestUtility,
  findNearestRailroad,
} from "./monopoly/board";
import {
  rollDice,
  isDoubles,
  moveBySteps,
  moveToSpace,
  computeRent,
  nextAliveSeat,
  houseCount,
  totalHouses,
  totalPhysicalHouses,
  totalHotels,
  canBuild,
  liquidateHouses,
  jailBailAmount,
  moveStockValue,
  rollStockMove,
} from "./monopoly/engine";
import { CHANCE_DECK, COMMUNITY_CHEST_DECK, drawCard, shuffleDeck } from "./monopoly/cards";
import {
  bid as auctionBidAction,
  pass as auctionPassAction,
  maybeFinish as auctionMaybeFinish,
  createAuction,
  currentBidderId,
  dropUnaffordable,
  buildBiddingOrder,
  type AuctionState,
} from "./monopoly/auction";
import {
  CASINO_STAKE,
  CASINO_CASH_PRIZE,
  canGamble,
  drawCasinoReward,
  firstUnownedDeed,
} from "./monopoly/casino";

const TOKENS = ["🟥 Battleship", "🐕 Dog", "🖐️ Hand", "👢 Boot", "🎩 Top Hat", "🐈 Cat", "🚗 Car", "🛒 Wheelbarrow"];
const GAME_NAME_ANIMALS = ["Orca", "Kiwi", "Axolotl", "Capybara", "Mantis", "Dodo", "Narwhal", "Taco"];
const BOT_NAMES = ["Ada", "Turing", "Maven", "Rook", "Pixel", "Scout", "Atlas"];

function makeCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function now(): number {
  return Date.now();
}

async function log(ctx: any, gameId: any, playerId: string | null, type: string, message: string) {
  await ctx.db.insert("events", { gameId, playerId: playerId ?? undefined, type, message, createdAt: now() });
}

async function deleteGameRecords(ctx: any, gameId: Id<"games">) {
  const [players, events, trades, auctions] = await Promise.all([
    ctx.db.query("players").withIndex("by_game", (q: any) => q.eq("gameId", gameId)).collect(),
    ctx.db.query("events").withIndex("by_game", (q: any) => q.eq("gameId", gameId)).collect(),
    ctx.db.query("trades").withIndex("by_game", (q: any) => q.eq("gameId", gameId)).collect(),
    ctx.db.query("auctions").withIndex("by_game", (q: any) => q.eq("gameId", gameId)).collect(),
  ]);
  for (const record of [...players, ...events, ...trades, ...auctions]) await ctx.db.delete(record._id);
  await ctx.db.delete(gameId);
}

async function requirePlayer(
  ctx: any,
  gameId: Id<"games">,
  userId: Id<"users">,
): Promise<{ game: Doc<"games">; player: Doc<"players">; players: Doc<"players">[] }> {
  const game = await ctx.db.get(gameId);
  if (!game) throw new Error("Game not found");
  const players = await ctx.db
    .query("players")
    .withIndex("by_game", (q: any) => q.eq("gameId", gameId))
    .collect();
  const player = players.find((p: Doc<"players">) => p.userId === userId);
  if (!player) throw new Error("You are not in this game");
  return { game, player, players };
}

function moneyById(players: Doc<"players">[]): Record<string, number> {
  return Object.fromEntries(players.map((p) => [p._id, p.money]));
}

function jailEntryState(player: Pick<Doc<"players">, "jailVisits">) {
  return {
    position: 10,
    inJail: true,
    jailTurns: 0,
    jailVisits: (player.jailVisits ?? 0) + 1,
  };
}

// Fire a push notification to whoever's turn it is now. Never throws — push
// failures must not break the actual game move. Scheduled after commit so the
// action sees the new turn state.
async function maybeNotifyTurn(ctx: any, gameId: any) {
  try {
    await ctx.scheduler.runAfter(0, internal.notify.notifyCurrentTurn, { gameId });
  } catch (err) {
    console.error("notifyCurrentTurn call failed:", err);
  }
}

async function moveCurrentPlayerStock(ctx: any, gameId: any, player: Doc<"players">) {
  const investment = player.stockInvestment ?? 0;
  if (investment <= 0) return;
  const percent = rollStockMove();
  const oldValue = player.stockValue ?? investment;
  const newValue = moveStockValue(investment, oldValue, percent);
  await ctx.db.patch(player._id, { stockValue: newValue });
  await log(ctx, gameId, player._id, "stockMarket", `${player.name}'s stock moved ${percent > 0 ? "+" : ""}${percent}% on their roll: $${oldValue} → $${newValue}.`);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const getMyGames = query({
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const myPlayers = await ctx.db.query("players").withIndex("by_user", (q) => q.eq("userId", userId)).collect();
    const games = await Promise.all(
      myPlayers.map((p) => ctx.db.get(p.gameId)),
    );
    const activeGames = games.filter((game): game is Doc<"games"> => Boolean(game && game.status !== "finished"));
    const gamesWithPermissions = await Promise.all(activeGames.map(async (game) => {
      const players = await ctx.db.query("players").withIndex("by_game", (q) => q.eq("gameId", game._id)).collect();
      const humanPlayers = players.filter((player) => !player.isBot);
      return {
        ...game,
        canDelete: humanPlayers.length === 1 && humanPlayers[0].userId === userId,
      };
    }));
    return gamesWithPermissions.sort((a, b) => b.lastActionAt - a.lastActionAt);
  },
});

export const getGame = query({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const game = await ctx.db.get(gameId);
    if (!game) throw new Error("Game not found");
    const players = await ctx.db
      .query("players")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect();
    const myPlayer = players.find((p) => p.userId === userId);
    const events = await ctx.db
      .query("events")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .order("desc")
      .take(60);
    const trades = await ctx.db.query("trades").withIndex("by_game", (q) => q.eq("gameId", gameId)).collect();
    const auctions = await ctx.db.query("auctions").withIndex("by_game", (q) => q.eq("gameId", gameId)).collect();
    const auction = auctions.find((a) => a.status === "active") ?? null;
    const pendingTrades = trades.filter(
      (t) => t.status === "pending" && (t.fromPlayerId === myPlayer?._id || t.toPlayerId === myPlayer?._id),
    );
    const houseSupply = HOUSE_SUPPLY - players.reduce((s, p) => s + totalHouses(p as any), 0);
    const hotelSupply = HOTEL_SUPPLY - players.reduce((s, p) => s + totalHotels(p as any), 0);
    return {
      game,
      players: players.sort((a, b) => a.seatIndex - b.seatIndex),
      myPlayerId: myPlayer?._id ?? null,
      events: events.map((e) => ({ ...e, _id: undefined })),
      pendingTrades: pendingTrades.map((t) => ({ ...t })),
      auction: auction ? { ...auction, _id: undefined } : null,
      houseSupply,
      hotelSupply,
    };
  },
});

export const getGameByCode = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const game = await ctx.db.query("games").withIndex("by_code", (q) => q.eq("code", code.trim().toUpperCase())).first();
    if (!game) throw new Error("No game with that code");
    const players = await ctx.db
      .query("players")
      .withIndex("by_game", (q) => q.eq("gameId", game._id))
      .collect();
    return { game, players: players.sort((a, b) => a.seatIndex - b.seatIndex), myPlayer: players.find((p) => p.userId === userId) ?? null };
  },
});

// ---------------------------------------------------------------------------
// Lobby mutations
// ---------------------------------------------------------------------------

export const createGame = mutation({
  args: { name: v.optional(v.string()) },
  handler: async (ctx, { name }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to create a game");
    let code = makeCode();
    while (await ctx.db.query("games").withIndex("by_code", (q) => q.eq("code", code)).first()) {
      code = makeCode();
    }
    const animal = GAME_NAME_ANIMALS[Math.floor(Math.random() * GAME_NAME_ANIMALS.length)];
    const gameId = await ctx.db.insert("games", {
      name: name?.trim() || `${animal}'s Monopoly`,
      code,
      status: "lobby",
      createdBy: userId,
      createdAt: now(),
      turn: 0,
      phase: "lobby",
      phaseData: {},
      doublesCount: 0,
      lastActionAt: now(),
      seed: Math.floor(Math.random() * 1e9),
      chanceDeck: shuffleDeck(CHANCE_DECK.length),
      communityChestDeck: shuffleDeck(COMMUNITY_CHEST_DECK.length),
    });
    await ctx.db.insert("players", {
      gameId,
      userId,
      seatIndex: 0,
      token: TOKENS[0],
      name: (await ctx.db.get(userId))?.name ?? "Player",
      money: STARTING_MONEY,
      position: 0,
      inJail: false,
      jailTurns: 0,
      jailVisits: 0,
      getOutOfJailCards: 0,
      bankrupt: false,
      properties: [],
      houses: [],
      mortgaged: [],
      stockInvestment: 0,
      stockValue: 0,
      joinedAt: now(),
    });
    await log(ctx, gameId, null, "lobby", "Game created — share code to friends");
    return gameId;
  },
});

export const joinGame = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to join a game");
    const game = await ctx.db.query("games").withIndex("by_code", (q) => q.eq("code", code.trim().toUpperCase())).first();
    if (!game) throw new Error("No game with that code");
    if (game.status !== "lobby") throw new Error("That game has already started");
    const players = await ctx.db.query("players").withIndex("by_game", (q) => q.eq("gameId", game._id)).collect();
    if (players.length >= 8) throw new Error("Game is full (8 max)");
    if (players.some((p) => p.userId === userId)) return game._id;
    const seat = players.length;
    await ctx.db.insert("players", {
      gameId: game._id,
      userId,
      seatIndex: seat,
      token: TOKENS[seat % TOKENS.length],
      name: (await ctx.db.get(userId))?.name ?? "Player",
      money: STARTING_MONEY,
      position: 0,
      inJail: false,
      jailTurns: 0,
      jailVisits: 0,
      getOutOfJailCards: 0,
      bankrupt: false,
      properties: [],
      houses: [],
      mortgaged: [],
      stockInvestment: 0,
      stockValue: 0,
      joinedAt: now(),
    });
    await ctx.db.patch(game._id, { lastActionAt: now() });
    await log(ctx, game._id, null, "lobby", `${(await ctx.db.get(userId))?.name ?? "Someone"} joined the game`);
    return game._id;
  },
});

export const addBot = mutation({
  args: {
    gameId: v.id("games"),
    playstyle: v.union(v.literal("conservative"), v.literal("balanced"), v.literal("aggressive")),
  },
  handler: async (ctx, { gameId, playstyle }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const game = await ctx.db.get(gameId);
    if (!game || game.status !== "lobby") throw new Error("Bots can only be added in the lobby");
    if (game.createdBy !== userId) throw new Error("Only the game creator can add bots");
    const players = await ctx.db.query("players").withIndex("by_game", (q) => q.eq("gameId", gameId)).collect();
    if (players.length >= 8) throw new Error("Game is full (8 max)");
    const seat = players.length;
    const botNumber = players.filter((candidate) => candidate.isBot).length;
    const name = `${BOT_NAMES[botNumber % BOT_NAMES.length]} (${playstyle})`;
    await ctx.db.insert("players", {
      gameId,
      seatIndex: seat,
      token: TOKENS[seat % TOKENS.length],
      name,
      money: STARTING_MONEY,
      position: 0,
      inJail: false,
      jailTurns: 0,
      jailVisits: 0,
      getOutOfJailCards: 0,
      bankrupt: false,
      properties: [],
      houses: [],
      mortgaged: [],
      stockInvestment: 0,
      stockValue: 0,
      isBot: true,
      botPlaystyle: playstyle,
      joinedAt: now(),
    });
    await log(ctx, gameId, null, "lobby", `${name} joined as a bot.`);
  },
});

export const leaveGame = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const game = await ctx.db.get(gameId);
    if (!game || game.status !== "lobby") throw new Error("Can only leave a lobby");
    const player = await ctx.db.query("players").withIndex("by_user", (q) => q.eq("userId", userId)).filter((q) => q.eq(q.field("gameId"), gameId)).first();
    if (!player) throw new Error("Not in game");
    await ctx.db.delete(player._id);
    const remaining = await ctx.db.query("players").withIndex("by_game", (q) => q.eq("gameId", gameId)).collect();
    if (remaining.every((remainingPlayer) => remainingPlayer.isBot)) {
      await deleteGameRecords(ctx, gameId);
      return;
    }
    // reseat so seatIndex stays contiguous
    for (const [i, p] of remaining.sort((a, b) => a.seatIndex - b.seatIndex).entries()) {
      if (p.seatIndex !== i) await ctx.db.patch(p._id, { seatIndex: i, token: TOKENS[i % TOKENS.length] });
    }
  },
});

export const deleteGame = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const game = await ctx.db.get(gameId);
    if (!game) throw new Error("Game not found");
    const players = await ctx.db.query("players").withIndex("by_game", (q) => q.eq("gameId", gameId)).collect();
    const humanPlayers = players.filter((player) => !player.isBot);
    if (humanPlayers.length !== 1 || humanPlayers[0].userId !== userId) {
      throw new Error("A game can only be deleted by its sole human player");
    }
    await deleteGameRecords(ctx, gameId);
  },
});

export const startGame = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const game = await ctx.db.get(gameId);
    if (!game || game.status !== "lobby") throw new Error("Game not in lobby");
    const players = await ctx.db.query("players").withIndex("by_game", (q) => q.eq("gameId", gameId)).collect();
    if (players.length < 2) throw new Error("Need at least 2 players");
    const me = players.find((p) => p.userId === userId);
    if (!me) throw new Error("You are not in this game");
    await ctx.db.patch(gameId, {
      status: "playing",
      startedAt: now(),
      turn: 0,
      phase: players[0].inJail ? "jail" : "roll",
      phaseData: {},
      lastActionAt: now(),
    });
    await log(ctx, gameId, null, "start", "Game started! Seat 0 goes first.");
    try {
      await ctx.scheduler.runAfter(0, internal.notify.notifyGameStarted, { gameId });
    } catch (err) {
      console.error("notifyGameStarted call failed:", err);
    }
  },
});

// ---------------------------------------------------------------------------
// Turn resolution helpers
// ---------------------------------------------------------------------------

// Apply landing effects for a player at `space`. Returns the next phase for the
// game, mutating player/game docs as needed. If `endedByJail` is true, the
// turn ends after resolution.
async function resolveLanding(
  ctx: any,
  game: any,
  player: any,
  players: any[],
  spaceIndex: number,
  diceSum: number,
): Promise<{ phase: string; phaseData: any; endTurn: boolean; advance: boolean }> {
  const space = getSpace(spaceIndex);
  const name = player.name;

  if (space.type === "go") {
    await log(ctx, game._id, player._id, "land", `${name} landed on GO.`);
    return { phase: "manage", phaseData: {}, endTurn: false, advance: false };
  }
  if (space.type === "casino") {
    await log(ctx, game._id, player._id, "casino", `${name} landed on the Casino and may enter for $${CASINO_STAKE}.`);
    return { phase: "casino", phaseData: {}, endTurn: false, advance: false };
  }
  if (space.type === "jail") {
    await log(ctx, game._id, player._id, "land", `${name} is just visiting Jail.`);
    return { phase: "manage", phaseData: {}, endTurn: false, advance: false };
  }
  if (space.type === "goToJail") {
    await ctx.db.patch(player._id, jailEntryState(player));
    await log(ctx, game._id, player._id, "jail", `${name} went to Jail!`);
    return { phase: "manage", phaseData: {}, endTurn: true, advance: true };
  }
  if (space.type === "tax") {
    await log(ctx, game._id, player._id, "tax", `${name} landed on ${space.name} and owes $${space.tax}.`);
    return {
      phase: "debt",
      phaseData: { amount: space.tax, to: "bank", reason: space.name, nextPhase: "manage", space: spaceIndex },
      endTurn: false,
      advance: false,
    };
  }
  if (space.type === "stockMarket") {
    await log(ctx, game._id, player._id, "stockMarket", `${name} landed on the Stock Market.`);
    return {
      phase: "stockMarket",
      phaseData: {
        investment: player.stockInvestment ?? 0,
        value: player.stockValue ?? 0,
      },
      endTurn: false,
      advance: false,
    };
  }
  if (space.type === "chance" || space.type === "communityChest") {
    const isChance = space.type === "chance";
    const deck = isChance ? CHANCE_DECK : COMMUNITY_CHEST_DECK;
    const draw = drawCard(
      deck.length,
      (isChance ? game.chanceDeck : game.communityChestDeck) ?? [],
      isChance ? game.lastChanceCard : game.lastCommunityChestCard,
    );
    await ctx.db.patch(game._id, isChance
      ? { chanceDeck: draw.remaining, lastChanceCard: draw.cardIndex }
      : { communityChestDeck: draw.remaining, lastCommunityChestCard: draw.cardIndex });
    return resolveCard(ctx, game, player, players, deck[draw.cardIndex], diceSum, spaceIndex);
  }
  if (space.type === "property" || space.type === "railroad" || space.type === "utility") {
    const owner = players.find((p: any) => p.properties.includes(spaceIndex) && !p.bankrupt);
    if (!owner) {
      await log(ctx, game._id, player._id, "land", `${name} landed on ${space.name} (unowned, $${space.price}).`);
      return { phase: "buy", phaseData: { space: spaceIndex }, endTurn: false, advance: false };
    }
    if (owner._id === player._id) {
      await log(ctx, game._id, player._id, "land", `${name} landed on their own ${space.name}.`);
      return { phase: "manage", phaseData: {}, endTurn: false, advance: false };
    }
    if (owner.inJail) {
      await log(ctx, game._id, player._id, "rent", `${owner.name} is in Jail, so no rent is collected on ${space.name}.`);
      return { phase: "manage", phaseData: {}, endTurn: false, advance: false };
    }
    const rent = computeRent(spaceIndex, owner, diceSum);
    if (rent.amount === 0) {
      await log(ctx, game._id, player._id, "rent", `${name} landed on ${owner.name}'s ${space.name} (mortgaged, no rent).`);
      return { phase: "manage", phaseData: {}, endTurn: false, advance: false };
    }
    await log(ctx, game._id, player._id, "rent", `${name} owes ${owner.name} $${rent.amount} rent on ${space.name} (${rent.breakdown}).`);
    if (player.money >= rent.amount) {
      await ctx.db.patch(player._id, { money: player.money - rent.amount });
      await ctx.db.patch(owner._id, { money: owner.money + rent.amount });
      await log(ctx, game._id, player._id, "paid", `${name} paid ${owner.name} $${rent.amount}.`);
      return { phase: "manage", phaseData: {}, endTurn: false, advance: false };
    }
    return {
      phase: "debt",
      phaseData: { amount: rent.amount, to: owner._id, reason: `rent on ${space.name}`, nextPhase: "manage", space: spaceIndex },
      endTurn: false,
      advance: false,
    };
  }
  return { phase: "manage", phaseData: {}, endTurn: false, advance: false };
}

// Resolve a drawn card. May move the player (which can chain another landing).
async function resolveCard(
  ctx: any,
  game: any,
  player: any,
  players: any[],
  card: any,
  diceSum: number,
  spaceIndex: number,
): Promise<{ phase: string; phaseData: any; endTurn: boolean; advance: boolean }> {
  const name = player.name;
  const deckName = spaceIndex === 7 || spaceIndex === 22 || spaceIndex === 36 ? "Chance" : "Community Chest";
  await log(ctx, game._id, player._id, "card", `${name} drew ${deckName}: "${card.text}"`);

  const e = card.effect;
  if (e.type === "collect") {
    await ctx.db.patch(player._id, { money: player.money + e.amount });
    await log(ctx, game._id, player._id, "money", `${name} collected $${e.amount}.`);
    return { phase: "manage", phaseData: {}, endTurn: false, advance: false };
  }
  if (e.type === "pay") {
    if (player.money >= e.amount) {
      await ctx.db.patch(player._id, { money: player.money - e.amount });
      await log(ctx, game._id, player._id, "money", `${name} paid the bank $${e.amount}.`);
      return { phase: "manage", phaseData: {}, endTurn: false, advance: false };
    }
    return {
      phase: "debt",
      phaseData: { amount: e.amount, to: "bank", reason: card.text, nextPhase: "manage", space: spaceIndex },
      endTurn: false,
      advance: false,
    };
  }
  if (e.type === "goToJail") {
    await ctx.db.patch(player._id, jailEntryState(player));
    await log(ctx, game._id, player._id, "jail", `${name} went directly to Jail.`);
    return { phase: "manage", phaseData: {}, endTurn: true, advance: true };
  }
  if (e.type === "jailFree") {
    await ctx.db.patch(player._id, { getOutOfJailCards: player.getOutOfJailCards + 1 });
    await log(ctx, game._id, player._id, "card", `${name} kept a Get Out of Jail Free card.`);
    return { phase: "manage", phaseData: {}, endTurn: false, advance: false };
  }
  if (e.type === "buildingWindfall") {
    const houses = totalPhysicalHouses(player);
    const hotels = totalHotels(player);
    const amount = houses * e.perHouse + hotels * e.perHotel;
    if (amount === 0) {
      await log(ctx, game._id, player._id, "money", `${name} owns no buildings — no windfall awarded.`);
      return { phase: "manage", phaseData: {}, endTurn: false, advance: false };
    }
    await ctx.db.patch(player._id, { money: player.money + amount });
    await log(
      ctx,
      game._id,
      player._id,
      "money",
      `${name} collected $${amount} from ${houses} house${houses === 1 ? "" : "s"} and ${hotels} hotel${hotels === 1 ? "" : "s"}.`,
    );
    return { phase: "manage", phaseData: {}, endTurn: false, advance: false };
  }
  if (e.type === "repairs") {
    const houses = totalPhysicalHouses(player);
    const hotels = totalHotels(player);
    const amount = houses * e.perHouse + hotels * e.perHotel;
    if (amount === 0) {
      await log(ctx, game._id, player._id, "money", `${name} owns no buildings — no repairs due.`);
      return { phase: "manage", phaseData: {}, endTurn: false, advance: false };
    }
    if (player.money >= amount) {
      await ctx.db.patch(player._id, { money: player.money - amount });
      await log(
        ctx,
        game._id,
        player._id,
        "money",
        `${name} paid $${amount} in repairs (${houses} house${houses === 1 ? "" : "s"}, ${hotels} hotel${hotels === 1 ? "" : "s"}).`,
      );
      return { phase: "manage", phaseData: {}, endTurn: false, advance: false };
    }
    return {
      phase: "debt",
      phaseData: { amount, to: "bank", reason: card.text, nextPhase: "manage", space: spaceIndex },
      endTurn: false,
      advance: false,
    };
  }
  if (e.type === "payEachPlayer") {
    const others = players.filter((p: any) => p._id !== player._id && !p.bankrupt && !p.inJail);
    const total = others.length * e.amount;
    if (player.money >= total) {
      await ctx.db.patch(player._id, { money: player.money - total });
      for (const o of others) await ctx.db.patch(o._id, { money: o.money + e.amount });
      await log(ctx, game._id, player._id, "money", `${name} paid each player $${e.amount}.`);
      return { phase: "manage", phaseData: {}, endTurn: false, advance: false };
    }
    return {
      phase: "debt",
      phaseData: { amount: total, to: "players", reason: card.text, nextPhase: "manage", space: spaceIndex },
      endTurn: false,
      advance: false,
    };
  }
  if (e.type === "moveRelative") {
    const moved = moveBySteps(player, e.spaces);
    await ctx.db.patch(player._id, { position: moved.position, money: player.money + moved.salary });
    if (moved.salary > 0) await log(ctx, game._id, player._id, "money", `${name} passed GO and collected $${moved.salary}.`);
    return resolveLanding(ctx, game, player, players, moved.position, diceSum);
  }
  if (e.type === "moveTo") {
    const moved = moveToSpace(player, e.space, e.collectOnPass ?? false);
    await ctx.db.patch(player._id, { position: moved.position, money: player.money + moved.salary });
    if (moved.salary > 0) await log(ctx, game._id, player._id, "money", `${name} passed GO and collected $${moved.salary}.`);
    return resolveLanding(ctx, game, player, players, moved.position, diceSum);
  }
  if (e.type === "nearestUtility") {
    const target = findNearestUtility(player.position);
    const dist = ((target - player.position) % 40 + 40) % 40;
    const moved = moveBySteps(player, dist);
    await ctx.db.patch(player._id, { position: moved.position, money: player.money + moved.salary });
    if (moved.salary > 0) await log(ctx, game._id, player._id, "money", `${name} passed GO and collected $${moved.salary}.`);
    return resolveLanding(ctx, game, player, players, target, diceSum);
  }
  if (e.type === "nearestRailroad") {
    const target = findNearestRailroad(player.position);
    const dist = ((target - player.position) % 40 + 40) % 40;
    const moved = moveBySteps(player, dist);
    await ctx.db.patch(player._id, { position: moved.position, money: player.money + moved.salary });
    if (moved.salary > 0) await log(ctx, game._id, player._id, "money", `${name} passed GO and collected $${moved.salary}.`);
    // If owned, rent is double. resolveLanding computes normal rent, so adjust here:
    const owner = players.find((p: any) => p.properties.includes(target) && !p.bankrupt);
    if (owner && owner._id !== player._id && !owner.inJail) {
      const rent = computeRent(target, owner, diceSum, 2);
      if (rent.amount > 0) {
        await log(ctx, game._id, player._id, "rent", `${name} pays double rent $${rent.amount} to ${owner.name}.`);
        if (player.money >= rent.amount) {
          await ctx.db.patch(player._id, { money: player.money - rent.amount });
          await ctx.db.patch(owner._id, { money: owner.money + rent.amount });
          return { phase: "manage", phaseData: {}, endTurn: false, advance: false };
        }
        return {
          phase: "debt",
          phaseData: { amount: rent.amount, to: owner._id, reason: `double rent on railroad`, nextPhase: "manage", space: target },
          endTurn: false,
          advance: false,
        };
      }
    }
    return resolveLanding(ctx, game, player, players, target, diceSum);
  }
  return { phase: "manage", phaseData: {}, endTurn: false, advance: false };
}

// ---------------------------------------------------------------------------
// Turn mutations
// ---------------------------------------------------------------------------

export const roll = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const { game, player, players } = await requirePlayer(ctx, gameId, userId);
    if (game.status !== "playing") throw new Error("Game is not in progress");
    if (game.phase !== "roll") throw new Error("Not your turn to roll");
    const turnPlayer = players[game.turn];
    if (turnPlayer._id !== player._id) throw new Error("It is not your turn");
    if (player.bankrupt) throw new Error("You are bankrupt");

    const dice = rollDice();
    const sum = dice[0] + dice[1];
    const doubles = isDoubles(dice);
    const newDoublesCount = doubles ? game.doublesCount + 1 : 0;

    await ctx.db.patch(gameId, { lastRoll: dice, lastRollSum: sum, lastActionAt: now() });
    await log(ctx, gameId, player._id, "roll", `${player.name} rolled ${dice[0]} + ${dice[1]} = ${sum}${doubles ? " (doubles!)" : ""}.`);
    await moveCurrentPlayerStock(ctx, gameId, player);

    if (doubles && newDoublesCount >= 3) {
      await ctx.db.patch(player._id, jailEntryState(player));
      await ctx.db.patch(gameId, { doublesCount: 0 });
      await log(ctx, gameId, player._id, "jail", `${player.name} rolled doubles 3x in a row — straight to Jail!`);
      const next = nextAliveSeat(players, game.turn);
      const nextPhase = players[next].inJail ? "jail" : "roll";
      await ctx.db.patch(gameId, { turn: next, phase: nextPhase, phaseData: {} });
    await maybeNotifyTurn(ctx, gameId);
      return;
    }

    const moved = moveBySteps(player, sum);
    const moneyAfterGo = player.money + moved.salary;
    await ctx.db.patch(player._id, { position: moved.position, money: moneyAfterGo });
    if (moved.salary > 0) await log(ctx, gameId, player._id, "money", `${player.name} passed GO and collected $${moved.salary}.`);

    const freshPlayers = await ctx.db.query("players").withIndex("by_game", (q) => q.eq("gameId", gameId)).collect();
    const freshPlayer = freshPlayers.find((p: any) => p._id === player._id)!;
    const res = await resolveLanding(ctx, game, freshPlayer, freshPlayers, moved.position, sum);

    // If debt phase, save it and wait for the debtor.
    if (res.phase === "debt") {
      await ctx.db.patch(gameId, { phase: "debt", phaseData: res.phaseData, doublesCount: newDoublesCount });
      return;
    }
    if (res.phase === "buy") {
      await ctx.db.patch(gameId, { phase: "buy", phaseData: res.phaseData, doublesCount: newDoublesCount });
      return;
    }
    if (res.phase === "stockMarket") {
      await ctx.db.patch(gameId, { phase: "stockMarket", phaseData: res.phaseData, doublesCount: newDoublesCount });
      return;
    }
    if (res.phase === "casino") {
      await ctx.db.patch(gameId, { phase: "casino", phaseData: {}, doublesCount: newDoublesCount });
      return;
    }
    // manage or end-of-turn
    if (doubles && !res.endTurn) {
      await ctx.db.patch(gameId, { phase: "roll", phaseData: {}, doublesCount: newDoublesCount });
      await log(ctx, gameId, player._id, "turn", `${player.name} rolled doubles — rolls again!`);
      return;
    }
    if (res.advance || res.endTurn) {
      const next = nextAliveSeat(players, game.turn);
      const nextPhase = players[next].inJail ? "jail" : "roll";
      await ctx.db.patch(gameId, { turn: next, phase: nextPhase, phaseData: {}, doublesCount: 0 });
    await maybeNotifyTurn(ctx, gameId);
      await log(ctx, gameId, null, "turn", `It's ${players[next].name}'s turn.`);
      return;
    }
    await ctx.db.patch(gameId, { phase: "manage", phaseData: {}, doublesCount: newDoublesCount });
    await log(ctx, gameId, player._id, "turn", `${player.name} can manage property or end turn.`);
  },
});

export const jailAction = mutation({
  args: { gameId: v.id("games"), action: v.union(v.literal("roll"), v.literal("pay"), v.literal("card")) },
  handler: async (ctx, { gameId, action }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const { game, player, players } = await requirePlayer(ctx, gameId, userId);
    if (game.status !== "playing") throw new Error("Game not in progress");
    if (game.phase !== "jail") throw new Error("Not a jail decision");
    const turnPlayer = players[game.turn];
    if (turnPlayer._id !== player._id) throw new Error("Not your turn");
    if (!player.inJail) throw new Error("You are not in jail");
    const bail = jailBailAmount(player);

    if (action === "pay") {
      if (player.money < bail) throw new Error("You cannot afford bail — sell or mortgage first");
      await ctx.db.patch(player._id, { money: player.money - bail, inJail: false, jailTurns: 0 });
      await log(ctx, gameId, player._id, "jail", `${player.name} paid $${bail} bail and is free.`);
      await ctx.db.patch(gameId, { phase: "roll", phaseData: {} });
      return;
    }
    if (action === "card") {
      if (player.getOutOfJailCards < 1) throw new Error("No Get Out of Jail Free card");
      await ctx.db.patch(player._id, { getOutOfJailCards: player.getOutOfJailCards - 1, inJail: false, jailTurns: 0 });
      await log(ctx, gameId, player._id, "jail", `${player.name} used a Get Out of Jail Free card.`);
      await ctx.db.patch(gameId, { phase: "roll", phaseData: {} });
      return;
    }
    // action === "roll"
    const dice = rollDice();
    const sum = dice[0] + dice[1];
    await ctx.db.patch(gameId, { lastRoll: dice, lastRollSum: sum, lastActionAt: now() });
    await log(ctx, gameId, player._id, "roll", `${player.name} rolled ${dice[0]} + ${dice[1]} = ${sum} in Jail.`);
    await moveCurrentPlayerStock(ctx, gameId, player);
    if (isDoubles(dice)) {
      const jailEscapeDoublesCount = 1;
      await ctx.db.patch(player._id, { inJail: false, jailTurns: 0 });
      await log(ctx, gameId, player._id, "jail", `${player.name} rolled doubles — out of Jail!`);
      const moved = moveBySteps(player, sum);
      await ctx.db.patch(player._id, { position: moved.position, money: player.money + moved.salary });
      if (moved.salary > 0) await log(ctx, gameId, player._id, "money", `${player.name} passed GO and collected $${moved.salary}.`);
      const freshPlayers = await ctx.db.query("players").withIndex("by_game", (q) => q.eq("gameId", gameId)).collect();
      const freshPlayer = freshPlayers.find((p: any) => p._id === player._id)!;
      const res = await resolveLanding(ctx, game, freshPlayer, freshPlayers, moved.position, sum);
      if (res.phase === "debt") {
        await ctx.db.patch(gameId, { phase: "debt", phaseData: res.phaseData, doublesCount: jailEscapeDoublesCount });
        return;
      }
      if (res.phase === "buy") {
        await ctx.db.patch(gameId, { phase: "buy", phaseData: res.phaseData, doublesCount: jailEscapeDoublesCount });
        return;
      }
      if (res.phase === "stockMarket" || res.phase === "casino") {
        await ctx.db.patch(gameId, { phase: res.phase, phaseData: res.phaseData, doublesCount: jailEscapeDoublesCount });
        return;
      }
      if (res.advance || res.endTurn) {
        const next = nextAliveSeat(players, game.turn);
        const nextPhase = players[next].inJail ? "jail" : "roll";
        await ctx.db.patch(gameId, { turn: next, phase: nextPhase, phaseData: {}, doublesCount: 0 });
        await maybeNotifyTurn(ctx, gameId);
        await log(ctx, gameId, null, "turn", `It's ${players[next].name}'s turn.`);
        return;
      }
      await ctx.db.patch(gameId, { phase: "roll", phaseData: {}, doublesCount: jailEscapeDoublesCount });
      return;
    }
    // not doubles
    const newJailTurns = player.jailTurns + 1;
    if (newJailTurns >= 3) {
      // third failed roll: must pay or use card; if can't pay, debt phase
      if (player.getOutOfJailCards > 0) {
        await ctx.db.patch(player._id, { getOutOfJailCards: player.getOutOfJailCards - 1, inJail: false, jailTurns: 0 });
        await log(ctx, gameId, player._id, "jail", `${player.name} used a Get Out of Jail Free card after 3 turns.`);
      } else if (player.money >= bail) {
        await ctx.db.patch(player._id, { money: player.money - bail, inJail: false, jailTurns: 0 });
        await log(ctx, gameId, player._id, "jail", `${player.name} paid $${bail} bail after 3 turns.`);
      } else {
        await ctx.db.patch(player._id, { jailTurns: newJailTurns });
        await ctx.db.patch(gameId, {
          phase: "debt",
          phaseData: { amount: bail, to: "bank", reason: "jail bail", nextPhase: "endTurn", space: 10 },
        });
        await log(ctx, gameId, player._id, "jail", `${player.name} cannot afford $${bail} bail — must raise money or go bankrupt.`);
        return;
      }
    } else {
      await ctx.db.patch(player._id, { jailTurns: newJailTurns });
      await log(ctx, gameId, player._id, "jail", `${player.name} failed to roll doubles (turn ${newJailTurns}/3 in Jail).`);
    }
    const next = nextAliveSeat(players, game.turn);
    const nextPhase = players[next].inJail ? "jail" : "roll";
    await ctx.db.patch(gameId, { turn: next, phase: nextPhase, phaseData: {}, doublesCount: 0 });
    await maybeNotifyTurn(ctx, gameId);
    await log(ctx, gameId, null, "turn", `It's ${players[next].name}'s turn.`);
  },
});

export const buyProperty = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const { game, player } = await requirePlayer(ctx, gameId, userId);
    if (game.phase !== "buy") throw new Error("Nothing to buy right now");
    const spaceIndex = game.phaseData.space as number;
    const space = getSpace(spaceIndex);
    if (player.money < (space.price ?? 0)) throw new Error("Not enough money to buy");
    const fresh = (await ctx.db.get(player._id))!;
    await ctx.db.patch(player._id, { money: fresh.money - (space.price ?? 0), properties: [...fresh.properties, spaceIndex] });
    await ctx.db.patch(gameId, { phase: game.doublesCount > 0 ? "roll" : "manage", phaseData: {} });
    await log(ctx, gameId, player._id, "buy", `${player.name} bought ${space.name} for $${space.price}.`);
  },
});

export const declineBuy = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const { game, player, players } = await requirePlayer(ctx, gameId, userId);
    if (game.phase !== "buy") throw new Error("Nothing to decline right now");
    const spaceIndex = game.phaseData.space as number;
    const space = getSpace(spaceIndex);
    const order = players.filter((p: any) => !p.bankrupt).sort((a: any, b: any) => a.seatIndex - b.seatIndex);
    // Start bidding with the player after the current turn player; the
    // declining player bids last.
    const bidding = buildBiddingOrder(order, game.turn);
    // Drop anyone who can't afford to bid at all up front.
    const moneyById = Object.fromEntries(order.map((p: any) => [p._id, p.money]));
    const startState = dropUnaffordable(createAuction(bidding, spaceIndex), moneyById);
    const auctionId = await ctx.db.insert("auctions", {
      gameId,
      spaceIndex,
      currentBid: 0,
      currentBidder: undefined,
      order: startState.order,
      nextIndex: startState.nextIndex,
      status: "active",
      createdAt: now(),
    });
    await ctx.db.patch(gameId, { phase: "auction", phaseData: { auctionId, space: spaceIndex } });
    await log(ctx, gameId, player._id, "auction", `${player.name} declined to buy ${space.name} — auction starts!`);
    try {
      await ctx.scheduler.runAfter(0, internal.notify.notifyAuctionBidder, {
        gameId,
        message: `Auction on ${space.name} just started. First bid?`,
      });
    } catch (err) {
      console.error("notifyAuctionBidder failed:", err);
    }
  },
});

export const auctionBid = mutation({
  args: { gameId: v.id("games"), amount: v.number() },
  handler: async (ctx, { gameId, amount }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const { game, player, players } = await requirePlayer(ctx, gameId, userId);
    if (game.phase !== "auction") throw new Error("No auction right now");
    const auction = (await ctx.db.get(game.phaseData.auctionId as Id<"auctions">))!;
    if (!auction || auction.status !== "active") throw new Error("Auction is over");
    const state: AuctionState<Id<"players">> = {
      spaceIndex: auction.spaceIndex,
      currentBid: auction.currentBid,
      currentBidder: auction.currentBidder,
      order: auction.order,
      nextIndex: auction.nextIndex,
      status: auction.status,
    };
    const next = dropUnaffordable(auctionBidAction(state, player._id, amount, player.money), moneyById(players));
    await ctx.db.patch(auction._id, {
      currentBid: next.currentBid,
      currentBidder: next.currentBidder,
      nextIndex: next.nextIndex,
      order: next.order,
    });
    await log(ctx, gameId, player._id, "auction", `${player.name} bids $${amount}.`);
    await ctx.db.patch(gameId, { lastActionAt: now() });
    await settleAuctionIfDone(ctx, gameId, game, next);
    // Tell the next bidder it's their turn to act (push + Discord feed event).
    if (next.status === "active" && currentBidderId(next)) {
      try {
        await ctx.scheduler.runAfter(0, internal.notify.notifyAuctionBidder, {
          gameId,
          message: `${player.name} bid $${amount} on ${getSpace(auction.spaceIndex).name}. Your bid?`,
        });
      } catch (err) {
        console.error("notifyAuctionBidder failed:", err);
      }
    }
  },
});

export const auctionPass = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const { game, player, players } = await requirePlayer(ctx, gameId, userId);
    if (game.phase !== "auction") throw new Error("No auction right now");
    const auction = (await ctx.db.get(game.phaseData.auctionId as Id<"auctions">))!;
    if (!auction || auction.status !== "active") throw new Error("Auction is over");
    const state: AuctionState<Id<"players">> = {
      spaceIndex: auction.spaceIndex,
      currentBid: auction.currentBid,
      currentBidder: auction.currentBidder,
      order: auction.order,
      nextIndex: auction.nextIndex,
      status: auction.status,
    };
    const next = dropUnaffordable(auctionPassAction(state, player._id), moneyById(players));
    await ctx.db.patch(auction._id, { order: next.order, nextIndex: next.nextIndex });
    await log(ctx, gameId, player._id, "auction", `${player.name} passes on the auction.`);
    await ctx.db.patch(gameId, { lastActionAt: now() });
    await settleAuctionIfDone(ctx, gameId, game, next);
    // Tell the next bidder it's their turn to act.
    if (next.status === "active" && currentBidderId(next)) {
      try {
        await ctx.scheduler.runAfter(0, internal.notify.notifyAuctionBidder, {
          gameId,
          message: `${player.name} passed on ${getSpace(auction.spaceIndex).name}. Your bid?`,
        });
      } catch (err) {
        console.error("notifyAuctionBidder failed:", err);
      }
    }
  },
});

async function settleAuctionIfDone(ctx: any, gameId: any, game: any, state: AuctionState<Id<"players">>) {
  const auction = (await ctx.db.get(game.phaseData.auctionId as Id<"auctions">))!;
  if (!auction || auction.status !== "active") return;
  const result = auctionMaybeFinish(state);
  if (!result) return; // auction continues — the current bidder must act
  await ctx.db.patch(auction._id, { status: "done", winner: result.winnerId, winningBid: result.winningBid });
  if (result.sold && result.winnerId) {
    const winner = (await ctx.db.get(result.winnerId as Id<"players">))!;
    await ctx.db.patch(winner._id, {
      money: winner.money - result.winningBid,
      properties: [...winner.properties, auction.spaceIndex],
    });
    await log(ctx, gameId, result.winnerId, "auction", `${winner.name} wins ${getSpace(auction.spaceIndex).name} for $${result.winningBid}.`);
  } else {
    await log(ctx, gameId, null, "auction", "No one bid — property stays with the bank.");
  }
  await ctx.db.patch(gameId, { phase: game.doublesCount > 0 ? "roll" : "manage", phaseData: {} });
}

export const casinoAction = mutation({
  args: {
    gameId: v.id("games"),
    action: v.union(v.literal("participate"), v.literal("pass")),
  },
  handler: async (ctx, { gameId, action }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const { game, player, players } = await requirePlayer(ctx, gameId, userId);
    if (game.status !== "playing") throw new Error("Game not in progress");
    if (game.phase !== "casino") throw new Error("Not at the Casino right now");
    if (players[game.turn]._id !== player._id) throw new Error("Not your turn");
    if (action === "pass") {
      await ctx.db.patch(gameId, { phase: game.doublesCount > 0 ? "roll" : "manage", phaseData: {}, lastActionAt: now() });
      await log(ctx, gameId, player._id, "casino", `${player.name} skipped the Casino.`);
      return;
    }
    const guard = canGamble(player.money);
    if (guard) throw new Error(guard);
    const reward = drawCasinoReward();
    const moneyAfterFee = player.money - CASINO_STAKE;
    if (reward === "property") {
      const deed = firstUnownedDeed(players.flatMap((candidate) => candidate.properties));
      if (deed) {
        await ctx.db.patch(player._id, { money: moneyAfterFee, properties: [...player.properties, deed.index] });
        await log(ctx, gameId, player._id, "casino", `${player.name} paid $${CASINO_STAKE} and won ${deed.name}!`);
      } else {
        await ctx.db.patch(player._id, { money: moneyAfterFee });
        await log(ctx, gameId, player._id, "casino", `${player.name} paid $${CASINO_STAKE}, drew a property prize, but no deeds remain.`);
      }
    } else if (reward === "cash") {
      await ctx.db.patch(player._id, { money: moneyAfterFee + CASINO_CASH_PRIZE });
      await log(ctx, gameId, player._id, "casino", `${player.name} paid $${CASINO_STAKE} and won $${CASINO_CASH_PRIZE}!`);
    } else {
      await ctx.db.patch(player._id, { money: moneyAfterFee });
      await log(ctx, gameId, player._id, "casino", `${player.name} paid $${CASINO_STAKE} and won nothing.`);
    }
    await ctx.db.patch(gameId, { phase: game.doublesCount > 0 ? "roll" : "manage", phaseData: {}, lastActionAt: now() });
  },
});

export const stockMarketAction = mutation({
  args: {
    gameId: v.id("games"),
    action: v.union(v.literal("invest"), v.literal("cashOut"), v.literal("pass")),
    amount: v.optional(v.number()),
  },
  handler: async (ctx, { gameId, action, amount }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const { game, player, players } = await requirePlayer(ctx, gameId, userId);
    if (game.status !== "playing") throw new Error("Game not in progress");
    if (action === "cashOut") {
      const value = player.stockValue ?? 0;
      if ((player.stockInvestment ?? 0) <= 0) throw new Error("You do not have a Stock Market investment");
      await ctx.db.patch(player._id, {
        money: player.money + value,
        stockInvestment: 0,
        stockValue: 0,
      });
      if (game.phase === "stockMarket" && players[game.turn]._id === player._id) {
        const nextPhase = game.doublesCount > 0 ? "roll" : "manage";
        await ctx.db.patch(gameId, { phase: nextPhase, phaseData: {}, lastActionAt: now() });
      }
      await log(ctx, gameId, player._id, "stockMarket", `${player.name} cashed out $${value} from the Stock Market.`);
      return;
    }

    if (game.phase !== "stockMarket") throw new Error("Stock can only be purchased at the Stock Market space");
    if (players[game.turn]._id !== player._id) throw new Error("Not your turn");
    const nextPhase = game.doublesCount > 0 ? "roll" : "manage";
    if (action === "pass") {
      await ctx.db.patch(gameId, { phase: nextPhase, phaseData: {}, lastActionAt: now() });
      await log(ctx, gameId, player._id, "stockMarket", `${player.name} passed on the Stock Market.`);
      return;
    }

    if (!Number.isInteger(amount) || amount === undefined || amount <= 0) throw new Error("Investment must be a positive whole-dollar amount");
    if (amount > player.money) throw new Error("Investment cannot exceed cash on hand");

    await ctx.db.patch(player._id, {
      money: player.money - amount,
      stockInvestment: (player.stockInvestment ?? 0) + amount,
      stockValue: (player.stockValue ?? 0) + amount,
    });
    await ctx.db.patch(gameId, { phase: nextPhase, phaseData: {}, lastActionAt: now() });
    await log(ctx, gameId, player._id, "stockMarket", `${player.name} invested $${amount} in the Stock Market.`);
  },
});

export const playBotStep = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const { game, players } = await requirePlayer(ctx, gameId, userId);
    if (game.status !== "playing") return;

    if (game.phase === "auction") {
      const auction = await ctx.db.get(game.phaseData.auctionId as Id<"auctions">);
      if (!auction || auction.status !== "active") return;
      const bidderId = currentBidderId(auction as AuctionState<Id<"players">>);
      const bidder = players.find((candidate) => candidate._id === bidderId);
      if (!bidder?.isBot) return;
      const style = bidder.botPlaystyle ?? "balanced";
      const reserve = style === "conservative" ? 800 : style === "balanced" ? 500 : 200;
      const propertyPrice = getSpace(auction.spaceIndex).price ?? 0;
      const maxBid = Math.min(propertyPrice * (style === "aggressive" ? 1.25 : style === "balanced" ? 1 : 0.75), bidder.money - reserve);
      const amount = auction.currentBid === 0 ? 1 : Math.ceil(auction.currentBid * 1.05);
      const state: AuctionState<Id<"players">> = {
        spaceIndex: auction.spaceIndex,
        currentBid: auction.currentBid,
        currentBidder: auction.currentBidder,
        order: auction.order,
        nextIndex: auction.nextIndex,
        status: auction.status,
      };
      const next = amount <= maxBid
        ? dropUnaffordable(auctionBidAction(state, bidder._id, amount, bidder.money), moneyById(players))
        : dropUnaffordable(auctionPassAction(state, bidder._id), moneyById(players));
      await ctx.db.patch(auction._id, {
        currentBid: next.currentBid,
        currentBidder: next.currentBidder,
        order: next.order,
        nextIndex: next.nextIndex,
      });
      await log(ctx, gameId, bidder._id, "auction", amount <= maxBid ? `${bidder.name} bids $${amount}.` : `${bidder.name} passes on the auction.`);
      await settleAuctionIfDone(ctx, gameId, game, next);
      return;
    }

    const bot = players[game.turn];
    if (!bot?.isBot || bot.bankrupt) return;
    const style = bot.botPlaystyle ?? "balanced";
    const reserve = style === "conservative" ? 800 : style === "balanced" ? 500 : 200;
    const finishLanding = async (res: { phase: string; phaseData: any; endTurn: boolean; advance: boolean }, doublesCount: number, doubles: boolean) => {
      if (["debt", "buy", "stockMarket", "casino"].includes(res.phase)) {
        await ctx.db.patch(gameId, { phase: res.phase, phaseData: res.phaseData, doublesCount });
      } else if (doubles && !res.endTurn) {
        await ctx.db.patch(gameId, { phase: "roll", phaseData: {}, doublesCount });
      } else if (res.advance || res.endTurn) {
        const next = nextAliveSeat(players, game.turn);
        await ctx.db.patch(gameId, { turn: next, phase: players[next].inJail ? "jail" : "roll", phaseData: {}, doublesCount: 0 });
      } else {
        await ctx.db.patch(gameId, { phase: "manage", phaseData: {}, doublesCount });
      }
    };

    if (game.phase === "roll") {
      const dice = rollDice();
      const sum = dice[0] + dice[1];
      const doubles = isDoubles(dice);
      const doublesCount = doubles ? game.doublesCount + 1 : 0;
      await ctx.db.patch(gameId, { lastRoll: dice, lastRollSum: sum, lastActionAt: now() });
      await log(ctx, gameId, bot._id, "roll", `${bot.name} rolled ${dice[0]} + ${dice[1]} = ${sum}${doubles ? " (doubles!)" : ""}.`);
      await moveCurrentPlayerStock(ctx, gameId, bot);
      if (doublesCount >= 3) {
        await ctx.db.patch(bot._id, jailEntryState(bot));
        const next = nextAliveSeat(players, game.turn);
        await ctx.db.patch(gameId, { turn: next, phase: players[next].inJail ? "jail" : "roll", phaseData: {}, doublesCount: 0 });
        return;
      }
      const moved = moveBySteps(bot as any, sum);
      await ctx.db.patch(bot._id, { position: moved.position, money: bot.money + moved.salary });
      const freshPlayers = await ctx.db.query("players").withIndex("by_game", (q) => q.eq("gameId", gameId)).collect();
      const freshBot = freshPlayers.find((candidate) => candidate._id === bot._id)!;
      const res = await resolveLanding(ctx, game, freshBot, freshPlayers, moved.position, sum);
      await finishLanding(res, doublesCount, doubles);
      return;
    }

    if (game.phase === "jail") {
      const bail = jailBailAmount(bot);
      if (bot.getOutOfJailCards > 0) {
        await ctx.db.patch(bot._id, { getOutOfJailCards: bot.getOutOfJailCards - 1, inJail: false, jailTurns: 0 });
      } else if (bot.money >= bail && (style !== "conservative" || bot.jailTurns >= 2)) {
        await ctx.db.patch(bot._id, { money: bot.money - bail, inJail: false, jailTurns: 0 });
      } else {
        const dice = rollDice();
        const sum = dice[0] + dice[1];
        await ctx.db.patch(gameId, { lastRoll: dice, lastRollSum: sum, lastActionAt: now() });
        await log(ctx, gameId, bot._id, "roll", `${bot.name} rolled ${dice[0]} + ${dice[1]} = ${sum} in Jail.`);
        await moveCurrentPlayerStock(ctx, gameId, bot);
        if (isDoubles(dice)) {
          await ctx.db.patch(bot._id, { inJail: false, jailTurns: 0 });
          const moved = moveBySteps(bot as any, sum);
          await ctx.db.patch(bot._id, { position: moved.position, money: bot.money + moved.salary });
          const freshPlayers = await ctx.db.query("players").withIndex("by_game", (q) => q.eq("gameId", gameId)).collect();
          const freshBot = freshPlayers.find((candidate) => candidate._id === bot._id)!;
          const res = await resolveLanding(ctx, game, freshBot, freshPlayers, moved.position, sum);
          await finishLanding(res, 1, true);
          return;
        } else {
          const jailTurns = bot.jailTurns + 1;
          if (jailTurns >= 3) {
            if (bot.money >= bail) {
              await ctx.db.patch(bot._id, { money: bot.money - bail, inJail: false, jailTurns: 0 });
            } else {
              await ctx.db.patch(bot._id, { jailTurns });
              await ctx.db.patch(gameId, { phase: "debt", phaseData: { amount: bail, to: "bank", reason: "jail bail", nextPhase: "endTurn", space: 10 } });
              return;
            }
          } else {
            await ctx.db.patch(bot._id, { jailTurns });
          }
          const next = nextAliveSeat(players, game.turn);
          await ctx.db.patch(gameId, { turn: next, phase: players[next].inJail ? "jail" : "roll", phaseData: {}, doublesCount: 0 });
          return;
        }
      }
      await ctx.db.patch(gameId, { phase: "roll", phaseData: {} });
      return;
    }

    if (game.phase === "buy") {
      const spaceIndex = game.phaseData.space as number;
      const space = getSpace(spaceIndex);
      const price = space.price ?? 0;
      if (bot.money >= price && (bot.money - price >= reserve || style === "aggressive")) {
        await ctx.db.patch(bot._id, { money: bot.money - price, properties: [...bot.properties, spaceIndex] });
        await ctx.db.patch(gameId, { phase: game.doublesCount > 0 ? "roll" : "manage", phaseData: {} });
        await log(ctx, gameId, bot._id, "buy", `${bot.name} bought ${space.name} for $${price}.`);
      } else {
        const order = players.filter((candidate) => !candidate.bankrupt).sort((a, b) => a.seatIndex - b.seatIndex);
        const state = dropUnaffordable(createAuction(buildBiddingOrder(order, game.turn), spaceIndex), moneyById(players));
        const auctionId = await ctx.db.insert("auctions", { gameId, spaceIndex, currentBid: 0, currentBidder: undefined, order: state.order, nextIndex: state.nextIndex, status: "active", createdAt: now() });
        await ctx.db.patch(gameId, { phase: "auction", phaseData: { auctionId, space: spaceIndex } });
      }
      return;
    }

    if (game.phase === "casino") {
      if (bot.money < CASINO_STAKE || style === "conservative") {
        await log(ctx, gameId, bot._id, "casino", `${bot.name} skipped the Casino.`);
      } else {
        const reward = drawCasinoReward();
        const money = bot.money - CASINO_STAKE;
        const deed = reward === "property" ? firstUnownedDeed(players.flatMap((candidate) => candidate.properties)) : null;
        await ctx.db.patch(bot._id, {
          money: money + (reward === "cash" ? CASINO_CASH_PRIZE : 0),
          ...(deed ? { properties: [...bot.properties, deed.index] } : {}),
        });
        await log(ctx, gameId, bot._id, "casino", `${bot.name} paid $${CASINO_STAKE} and won ${deed ? deed.name : reward === "cash" ? `$${CASINO_CASH_PRIZE}` : "nothing"}.`);
      }
      await ctx.db.patch(gameId, { phase: game.doublesCount > 0 ? "roll" : "manage", phaseData: {} });
      return;
    }

    if (game.phase === "stockMarket") {
      const ratio = style === "conservative" ? 0.1 : style === "balanced" ? 0.25 : 0.5;
      const amount = Math.max(0, Math.floor((bot.money - reserve) * ratio));
      if (amount > 0) await ctx.db.patch(bot._id, { money: bot.money - amount, stockInvestment: (bot.stockInvestment ?? 0) + amount, stockValue: (bot.stockValue ?? 0) + amount });
      await ctx.db.patch(gameId, { phase: game.doublesCount > 0 ? "roll" : "manage", phaseData: {} });
      return;
    }

    if (game.phase === "debt") {
      const amount = game.phaseData.amount as number;
      let cash = bot.money;
      const newlyMortgaged: number[] = [];
      for (const spaceIndex of bot.properties) {
        if (cash >= amount) break;
        if (bot.mortgaged.includes(spaceIndex) || houseCount(bot as any, spaceIndex) > 0) continue;
        const mortgage = getSpace(spaceIndex).mortgage ?? 0;
        if (mortgage > 0) {
          cash += mortgage;
          newlyMortgaged.push(spaceIndex);
        }
      }
      if (newlyMortgaged.length) await ctx.db.patch(bot._id, { money: cash, mortgaged: [...bot.mortgaged, ...newlyMortgaged] });
      if (cash >= amount) {
        const { to, reason, nextPhase } = game.phaseData;
        await ctx.db.patch(bot._id, { money: cash - amount, ...(reason === "jail bail" ? { inJail: false, jailTurns: 0 } : {}) });
        if (to !== "bank" && to !== "players") {
          const creditor = await ctx.db.get(to as Id<"players">);
          if (creditor) await ctx.db.patch(creditor._id, { money: creditor.money + amount });
        }
        if (nextPhase === "endTurn") {
          const next = nextAliveSeat(players, game.turn);
          await ctx.db.patch(gameId, { turn: next, phase: players[next].inJail ? "jail" : "roll", phaseData: {}, doublesCount: 0 });
        } else {
          await ctx.db.patch(gameId, { phase: game.doublesCount > 0 ? "roll" : "manage", phaseData: {} });
        }
      } else {
        const insolventBot = (await ctx.db.get(bot._id))!;
        const totalCash = insolventBot.money + liquidateHouses(insolventBot as any);
        await ctx.db.patch(bot._id, {
          money: 0,
          houses: [],
          properties: [],
          mortgaged: [],
          stockInvestment: 0,
          stockValue: 0,
          bankrupt: true,
        });
        const { to } = game.phaseData;
        if (to !== "bank" && to !== "players") {
          const creditor = await ctx.db.get(to as Id<"players">);
          if (creditor) {
            await ctx.db.patch(creditor._id, {
              money: creditor.money + totalCash,
              properties: [...creditor.properties, ...insolventBot.properties],
              mortgaged: [...creditor.mortgaged, ...insolventBot.mortgaged],
              stockInvestment: (creditor.stockInvestment ?? 0) + (insolventBot.stockInvestment ?? 0),
              stockValue: (creditor.stockValue ?? 0) + (insolventBot.stockValue ?? 0),
            });
          }
        } else if (to === "players") {
          const others = players.filter((candidate) => !candidate.bankrupt && candidate._id !== bot._id);
          const share = others.length ? Math.floor(totalCash / others.length) : 0;
          for (const other of others) await ctx.db.patch(other._id, { money: other.money + share });
        }
        const alive = players.filter((candidate) => !candidate.bankrupt && candidate._id !== bot._id);
        if (alive.length <= 1) {
          await ctx.db.patch(gameId, { status: "finished", phase: "gameOver", phaseData: { winner: alive[0]?._id ?? null }, winner: alive[0]?._id, endedAt: now(), lastActionAt: now() });
        } else {
          const next = nextAliveSeat(players, game.turn);
          await ctx.db.patch(gameId, { turn: next, phase: players[next].inJail ? "jail" : "roll", phaseData: {}, doublesCount: 0 });
        }
      }
      return;
    }

    if (game.phase === "manage") {
      const next = nextAliveSeat(players, game.turn);
      await ctx.db.patch(gameId, { turn: next, phase: players[next].inJail ? "jail" : "roll", phaseData: {}, doublesCount: 0, lastActionAt: now() });
    }
  },
});

export const endTurn = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const { game, player, players } = await requirePlayer(ctx, gameId, userId);
    if (game.status !== "playing") throw new Error("Game not in progress");
    if (game.phase !== "manage") throw new Error("You cannot end your turn right now");
    const turnPlayer = players[game.turn];
    if (turnPlayer._id !== player._id) throw new Error("Not your turn");
    const next = nextAliveSeat(players, game.turn);
    const nextPhase = players[next].inJail ? "jail" : "roll";
    await ctx.db.patch(gameId, { turn: next, phase: nextPhase, phaseData: {}, doublesCount: 0, lastActionAt: now() });
    await maybeNotifyTurn(ctx, gameId);
    await log(ctx, gameId, null, "turn", `${player.name} ended their turn. It's ${players[next].name}'s turn.`);
  },
});

// ---------------------------------------------------------------------------
// Debt / bankruptcy
// ---------------------------------------------------------------------------

export const settleDebt = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const { game, player, players } = await requirePlayer(ctx, gameId, userId);
    if (game.phase !== "debt") throw new Error("No debt to settle");
    const { amount, to, nextPhase, reason } = game.phaseData;
    if (player.money < amount) throw new Error("You still don't have enough cash — sell, mortgage, or declare bankruptcy");
    const fresh = (await ctx.db.get(player._id))!;
    await ctx.db.patch(player._id, {
      money: fresh.money - amount,
      ...(reason === "jail bail" ? { inJail: false, jailTurns: 0 } : {}),
    });
    if (to === "bank") {
      await log(ctx, gameId, player._id, "paid", `${player.name} paid the bank $${amount}.`);
    } else if (to === "players") {
      const others = players.filter((p: any) => p._id !== player._id && !p.bankrupt);
      const share = Math.floor(amount / others.length);
      for (const o of others) await ctx.db.patch(o._id, { money: o.money + share });
      await log(ctx, gameId, player._id, "paid", `${player.name} paid each player $${share}.`);
    } else {
      const creditor = await ctx.db.get(to as Id<"players">);
      if (creditor) {
        await ctx.db.patch(creditor._id, { money: creditor.money + amount });
        await log(ctx, gameId, player._id, "paid", `${player.name} paid ${creditor.name} $${amount}.`);
      }
    }
    if (nextPhase === "endTurn") {
      const next = nextAliveSeat(players, game.turn);
      const nextPhase2 = players[next].inJail ? "jail" : "roll";
      await ctx.db.patch(gameId, { turn: next, phase: nextPhase2, phaseData: {}, doublesCount: 0 });
    await maybeNotifyTurn(ctx, gameId);
      await log(ctx, gameId, null, "turn", `It's ${players[next].name}'s turn.`);
    } else {
      await ctx.db.patch(gameId, { phase: game.doublesCount > 0 ? "roll" : "manage", phaseData: {} });
    }
  },
});

export const declareBankruptcy = mutation({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const { game, player, players } = await requirePlayer(ctx, gameId, userId);
    if (game.phase !== "debt") throw new Error("No debt to resolve");
    const { to } = game.phaseData;
    const fresh = (await ctx.db.get(player._id))!;
    const cashFromLiquidation = liquidateHouses(fresh as any);
    const totalCash = fresh.money + cashFromLiquidation;
    await ctx.db.patch(player._id, {
      money: 0,
      houses: [],
      properties: [],
      mortgaged: [],
      stockInvestment: 0,
      stockValue: 0,
      bankrupt: true,
    });
    await log(ctx, gameId, player._id, "bankrupt", `${player.name} went bankrupt! (assets liquidated)`);

    if (to !== "bank" && to !== "players") {
      // creditor is a player
      const creditor = await ctx.db.get(to as Id<"players">);
      if (creditor) {
        await ctx.db.patch(creditor._id, {
          money: creditor.money + totalCash,
          properties: [...creditor.properties, ...fresh.properties],
          mortgaged: [...creditor.mortgaged, ...fresh.mortgaged],
          stockInvestment: (creditor.stockInvestment ?? 0) + (fresh.stockInvestment ?? 0),
          stockValue: (creditor.stockValue ?? 0) + (fresh.stockValue ?? 0),
        });
        await log(ctx, gameId, player._id, "bankrupt", `${creditor.name} receives ${player.name}'s cash ($${totalCash}), properties, and stock.`);
      }
    } else if (to === "players") {
      const others = players.filter((p: any) => p._id !== player._id && !p.bankrupt);
      const share = others.length ? Math.floor(totalCash / others.length) : 0;
      for (const o of others) await ctx.db.patch(o._id, { money: o.money + share });
      await log(ctx, gameId, player._id, "bankrupt", `${player.name}'s cash ($${totalCash}) split among players.`);
    } else {
      await log(ctx, gameId, player._id, "bankrupt", `${player.name}'s properties return to the bank.`);
    }

    const alive = players.filter((p: any) => !p.bankrupt && p._id !== player._id);
    if (alive.length <= 1) {
      const winner = alive[0];
      await ctx.db.patch(gameId, {
        status: "finished",
        phase: "gameOver",
        phaseData: { winner: winner?._id ?? null },
        endedAt: now(),
        winner: winner?._id ?? undefined,
        lastActionAt: now(),
      });
      await log(ctx, gameId, null, "end", `${winner ? winner.name : "Nobody"} wins the game! 🎉`);
      return;
    }
    // current turn player went bankrupt; advance turn
    const next = nextAliveSeat(players, game.turn);
    const nextPhase = players[next].inJail ? "jail" : "roll";
    await ctx.db.patch(gameId, { turn: next, phase: nextPhase, phaseData: {}, doublesCount: 0, lastActionAt: now() });
    await maybeNotifyTurn(ctx, gameId);
    await log(ctx, gameId, null, "turn", `It's ${players[next].name}'s turn.`);
  },
});

// ---------------------------------------------------------------------------
// Property management
// ---------------------------------------------------------------------------

export const buildHouse = mutation({
  args: { gameId: v.id("games"), space: v.number() },
  handler: async (ctx, { gameId, space }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const { game, player, players } = await requirePlayer(ctx, gameId, userId);
    if (game.status !== "playing") throw new Error("Game not in progress");
    if (game.phase !== "manage") throw new Error("You can only build during your turn");
    const turnPlayer = players[game.turn];
    if (turnPlayer._id !== player._id) throw new Error("Not your turn");
    const spaceInfo = getSpace(space);
    if (spaceInfo.type === "property" && !isOnPropertySet(player.position, space)) {
      throw new Error("Land on a property in this color set before building");
    }
    const houseSupply = HOUSE_SUPPLY - players.reduce((s, p: any) => s + totalHouses(p), 0);
    const hotelSupply = HOTEL_SUPPLY - players.reduce((s, p: any) => s + totalHotels(p), 0);
    const err = canBuild(player as any, space, houseSupply, hotelSupply);
    if (err) throw new Error(err);
    const fresh = (await ctx.db.get(player._id))!;
    const nextCount = houseCount(fresh as any, space) + 1;
    const houses = [...fresh.houses.filter((h: any) => h.space !== space), { space, count: nextCount }];
    await ctx.db.patch(player._id, { houses, money: fresh.money - (spaceInfo.houseCost ?? 0) });
    await log(ctx, gameId, player._id, "build", `${player.name} built ${nextCount === 5 ? "a hotel" : `house ${nextCount}`} on ${spaceInfo.name}.`);
  },
});

export const sellHouse = mutation({
  args: { gameId: v.id("games"), space: v.number() },
  handler: async (ctx, { gameId, space }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const { game, player } = await requirePlayer(ctx, gameId, userId);
    const allowedPhase = game.phase === "manage" || game.phase === "debt";
    if (!allowedPhase) throw new Error("You cannot sell houses right now");
    if (game.phase === "manage") {
      const turnPlayer = (await ctx.db.query("players").withIndex("by_game", (q) => q.eq("gameId", gameId)).collect())[game.turn];
      if (turnPlayer._id !== player._id) throw new Error("Not your turn");
    }
    const fresh = (await ctx.db.get(player._id))!;
    const current = houseCount(fresh as any, space);
    if (current === 0) throw new Error("No houses there");
    const spaceInfo = getSpace(space);
    const refund = Math.floor((spaceInfo.houseCost ?? 0) / 2);
    const houses = fresh.houses.map((h: any) => (h.space === space ? { space, count: h.count - 1 } : h)).filter((h: any) => h.count > 0);
    await ctx.db.patch(player._id, { houses, money: fresh.money + refund });
    await log(ctx, gameId, player._id, "build", `${player.name} sold a house on ${spaceInfo.name} for $${refund}.`);
  },
});

export const mortgage = mutation({
  args: { gameId: v.id("games"), space: v.number() },
  handler: async (ctx, { gameId, space }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const { game, player, players } = await requirePlayer(ctx, gameId, userId);
    if (game.status !== "playing") throw new Error("Game not in progress");
    if (players[game.turn]?._id !== player._id) throw new Error("Not your turn");
    const fresh = (await ctx.db.get(player._id))!;
    if (!fresh.properties.includes(space)) throw new Error("You don't own that");
    if (fresh.mortgaged.includes(space)) throw new Error("Already mortgaged");
    if (houseCount(fresh as any, space) > 0) throw new Error("Sell the houses first");
    const spaceInfo = getSpace(space);
    const value = spaceInfo.mortgage ?? 0;
    await ctx.db.patch(player._id, { mortgaged: [...fresh.mortgaged, space], money: fresh.money + value });
    await log(ctx, gameId, player._id, "mortgage", `${player.name} mortgaged ${spaceInfo.name} for $${value}.`);
  },
});

export const unmortgage = mutation({
  args: { gameId: v.id("games"), space: v.number() },
  handler: async (ctx, { gameId, space }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const { game, player } = await requirePlayer(ctx, gameId, userId);
    if (game.phase !== "manage") throw new Error("You can only unmortgage during your turn");
    const all = await ctx.db.query("players").withIndex("by_game", (q) => q.eq("gameId", gameId)).collect();
    if (all[game.turn]._id !== player._id) throw new Error("Not your turn");
    const fresh = (await ctx.db.get(player._id))!;
    if (!fresh.mortgaged.includes(space)) throw new Error("Not mortgaged");
    const spaceInfo = getSpace(space);
    const cost = Math.ceil((spaceInfo.mortgage ?? 0) * 1.1);
    if (fresh.money < cost) throw new Error("Not enough money");
    await ctx.db.patch(player._id, {
      mortgaged: fresh.mortgaged.filter((s: number) => s !== space),
      money: fresh.money - cost,
    });
    await log(ctx, gameId, player._id, "mortgage", `${player.name} unmortgaged ${spaceInfo.name} for $${cost}.`);
  },
});

// ---------------------------------------------------------------------------
// Trading
// ---------------------------------------------------------------------------

export const sendTrade = mutation({
  args: {
    gameId: v.id("games"),
    toPlayerId: v.id("players"),
    fromCash: v.number(),
    fromProperties: v.array(v.number()),
    toCash: v.number(),
    toProperties: v.array(v.number()),
  },
  handler: async (ctx, { gameId, toPlayerId, fromCash, fromProperties, toCash, toProperties }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const { game, player, players } = await requirePlayer(ctx, gameId, userId);
    if (game.status !== "playing") throw new Error("Game not in progress");
    if (player.bankrupt) throw new Error("Bankrupt players cannot trade");
    const target = players.find((p: any) => p._id === toPlayerId);
    if (!target || target.bankrupt) throw new Error("That player cannot trade");
    if (toPlayerId === player._id) throw new Error("Can't trade with yourself");
    for (const s of fromProperties) {
      if (!player.properties.includes(s)) throw new Error("You don't own one of those properties");
      if (player.mortgaged.includes(s)) throw new Error("Unmortgage properties before trading");
      if (houseCount(player as any, s) > 0) throw new Error("Sell houses before trading a property");
    }
    for (const s of toProperties) {
      if (!target.properties.includes(s)) throw new Error("Target doesn't own one of those properties");
      if (target.mortgaged.includes(s)) throw new Error("Target's property is mortgaged");
      if (houseCount(target as any, s) > 0) throw new Error("Target must sell houses first");
    }
    if (fromCash < 0 || toCash < 0) throw new Error("Cash amounts must be non-negative");
    if (player.money < fromCash) throw new Error("You don't have that much cash");
    if (target.money < toCash) throw new Error("Target doesn't have that much cash");
    const tradeId = await ctx.db.insert("trades", {
      gameId,
      fromPlayerId: player._id,
      toPlayerId,
      fromCash,
      fromProperties,
      toCash,
      toProperties,
      status: "pending",
      createdAt: now(),
    });
    await log(ctx, gameId, player._id, "trade", `${player.name} sent a trade offer to ${target.name}.`);
    if (target.isBot) {
      const propertyValue = (spaces: number[]) => spaces.reduce((sum, space) => sum + (getSpace(space).price ?? 0), 0);
      const valueReceivedByBot = fromCash + propertyValue(fromProperties);
      const valueGivenByBot = toCash + propertyValue(toProperties);
      if (valueReceivedByBot >= valueGivenByBot) {
        await ctx.db.patch(player._id, {
          money: player.money - fromCash + toCash,
          properties: player.properties.filter((space) => !fromProperties.includes(space)).concat(toProperties),
        });
        await ctx.db.patch(target._id, {
          money: target.money - toCash + fromCash,
          properties: target.properties.filter((space) => !toProperties.includes(space)).concat(fromProperties),
        });
        await ctx.db.patch(tradeId, { status: "accepted", resolvedAt: now() });
        await log(ctx, gameId, target._id, "trade", `${target.name} accepted ${player.name}'s trade offer.`);
      } else {
        await ctx.db.patch(tradeId, { status: "declined", resolvedAt: now() });
        await log(ctx, gameId, target._id, "trade", `${target.name} declined ${player.name}'s trade offer.`);
      }
      return;
    }
    try {
      await ctx.scheduler.runAfter(0, internal.notify.notifyTrade, {
        gameId,
        toPlayerId: target._id,
        fromName: player.name,
      });
    } catch (err) {
      console.error("notifyTrade call failed:", err);
    }
  },
});

export const respondTrade = mutation({
  args: { tradeId: v.id("trades"), accept: v.boolean() },
  handler: async (ctx, { tradeId, accept }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const trade = await ctx.db.get(tradeId);
    if (!trade || trade.status !== "pending") throw new Error("Trade is not pending");
    const player = await ctx.db.query("players").withIndex("by_user", (q) => q.eq("userId", userId)).filter((q) => q.eq(q.field("gameId"), trade.gameId)).first();
    if (!player || player._id !== trade.toPlayerId) throw new Error("This trade was not sent to you");
    const from = await ctx.db.get(trade.fromPlayerId);
    const to = await ctx.db.get(trade.toPlayerId);
    if (!from || !to || from.bankrupt || to.bankrupt) throw new Error("A player in this trade is gone");
    if (!accept) {
      await ctx.db.patch(trade._id, { status: "declined", resolvedAt: now() });
      await log(ctx, trade.gameId, player._id, "trade", `${to.name} declined the trade offer.`);
      return;
    }
    // Verify the offers are still valid (both sides still own what they offered).
    for (const s of trade.fromProperties) {
      if (!from.properties.includes(s)) throw new Error("Offer no longer valid (property changed)");
      if (from.mortgaged.includes(s)) throw new Error("Offer no longer valid (property mortgaged)");
    }
    for (const s of trade.toProperties) {
      if (!to.properties.includes(s)) throw new Error("Offer no longer valid (property changed)");
      if (to.mortgaged.includes(s)) throw new Error("Offer no longer valid (property mortgaged)");
    }
    const newFromProps = from.properties.filter((s: number) => !trade.fromProperties.includes(s)).concat(trade.toProperties);
    const newToProps = to.properties.filter((s: number) => !trade.toProperties.includes(s)).concat(trade.fromProperties);
    await ctx.db.patch(from._id, {
      properties: newFromProps,
      money: from.money - trade.fromCash + trade.toCash,
    });
    await ctx.db.patch(to._id, {
      properties: newToProps,
      money: to.money - trade.toCash + trade.fromCash,
    });
    await ctx.db.patch(trade._id, { status: "accepted", resolvedAt: now() });
    await log(ctx, trade.gameId, player._id, "trade", `${from.name} and ${to.name} completed a trade. 🤝`);
  },
});

export const cancelTrade = mutation({
  args: { tradeId: v.id("trades") },
  handler: async (ctx, { tradeId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const trade = await ctx.db.get(tradeId);
    if (!trade || trade.status !== "pending") throw new Error("Trade is not pending");
    const player = await ctx.db.query("players").withIndex("by_user", (q) => q.eq("userId", userId)).filter((q) => q.eq(q.field("gameId"), trade.gameId)).first();
    if (!player || (player._id !== trade.fromPlayerId && player._id !== trade.toPlayerId)) {
      throw new Error("Not part of this trade");
    }
    await ctx.db.patch(trade._id, { status: "cancelled", resolvedAt: now() });
    await log(ctx, trade.gameId, player._id, "trade", "A trade offer was cancelled.");
  },
});
