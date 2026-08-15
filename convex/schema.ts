import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,

  games: defineTable({
    name: v.string(),
    code: v.string(),
    status: v.union(
      v.literal("lobby"),
      v.literal("playing"),
      v.literal("finished"),
    ),
    createdBy: v.id("users"),
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    // seat index whose turn it is
    turn: v.number(),
    // game state machine phase, see convex/monopoly/engine.ts
    phase: v.string(),
    phaseData: v.any(),
    lastRoll: v.optional(v.array(v.number())),
    lastRollSum: v.optional(v.number()),
    doublesCount: v.number(),
    winner: v.optional(v.id("players")),
    lastActionAt: v.number(),
    seed: v.number(),
    chanceDeck: v.optional(v.array(v.number())),
    communityChestDeck: v.optional(v.array(v.number())),
    lastChanceCard: v.optional(v.number()),
    lastCommunityChestCard: v.optional(v.number()),
  })
    .index("by_code", ["code"])
    .index("by_status", ["status"])
    .index("by_created", ["createdAt"]),

  players: defineTable({
    gameId: v.id("games"),
    userId: v.optional(v.id("users")),
    seatIndex: v.number(),
    token: v.string(),
    name: v.string(),
    money: v.number(),
    position: v.number(),
    inJail: v.boolean(),
    jailTurns: v.number(),
    jailVisits: v.optional(v.number()),
    getOutOfJailCards: v.number(),
    bankrupt: v.boolean(),
    properties: v.array(v.number()),
    houses: v.array(v.object({ space: v.number(), count: v.number() })),
    mortgaged: v.array(v.number()),
    stockInvestment: v.optional(v.number()),
    stockValue: v.optional(v.number()),
    isBot: v.optional(v.boolean()),
    botPlaystyle: v.optional(v.union(
      v.literal("conservative"),
      v.literal("balanced"),
      v.literal("aggressive"),
    )),
    joinedAt: v.number(),
  })
    .index("by_game", ["gameId"])
    .index("by_user", ["userId"]),

  events: defineTable({
    gameId: v.id("games"),
    playerId: v.optional(v.id("players")),
    type: v.string(),
    message: v.string(),
    createdAt: v.number(),
  })
    .index("by_game", ["gameId", "createdAt"]),

  chatMessages: defineTable({
    gameId: v.id("games"),
    playerId: v.id("players"),
    playerName: v.string(),
    message: v.string(),
    createdAt: v.number(),
  })
    .index("by_game", ["gameId", "createdAt"]),

  trades: defineTable({
    gameId: v.id("games"),
    fromPlayerId: v.id("players"),
    toPlayerId: v.id("players"),
    fromCash: v.number(),
    fromProperties: v.array(v.number()),
    toCash: v.number(),
    toProperties: v.array(v.number()),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("declined"),
      v.literal("cancelled"),
    ),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_game", ["gameId"]),

  auctions: defineTable({
    gameId: v.id("games"),
    spaceIndex: v.number(),
    currentBid: v.number(),
    currentBidder: v.optional(v.id("players")),
    order: v.array(v.id("players")),
    nextIndex: v.number(),
    status: v.union(v.literal("active"), v.literal("done")),
    winner: v.optional(v.id("players")),
    winningBid: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_game", ["gameId"]),

  pushSubscriptions: defineTable({
    userId: v.id("users"),
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_endpoint", ["endpoint"]),
});
