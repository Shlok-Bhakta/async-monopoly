import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { getSpace } from "./monopoly/board";

function now(): number {
  return Date.now();
}

// ---------------------------------------------------------------------------
// Internal DB access (used by node actions in notify.ts)
// ---------------------------------------------------------------------------

export const getSubscriptions = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const getGameState = internalQuery({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const game = await ctx.db.get(gameId);
    const players = await ctx.db
      .query("players")
      .withIndex("by_game", (q) => q.eq("gameId", gameId))
      .collect();
    return { game, players };
  },
});

export const getPlayer = internalQuery({
  args: { playerId: v.id("players") },
  handler: async (ctx, { playerId }) => {
    return await ctx.db.get(playerId);
  },
});

export const deleteSubscription = internalMutation({
  args: { id: v.id("pushSubscriptions") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

// ---------------------------------------------------------------------------
// Public API (client)
// ---------------------------------------------------------------------------

export const getVapidPublicKey = query({
  handler: async () => process.env.VAPID_PUBLIC_KEY ?? null,
});

export const subscribePush = mutation({
  args: v.object({
    subscription: v.object({
      endpoint: v.string(),
      p256dh: v.string(),
      auth: v.string(),
    }),
  }),
  handler: async (ctx, { subscription }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", subscription.endpoint))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        userId,
        p256dh: subscription.p256dh,
        auth: subscription.auth,
      });
    } else {
      await ctx.db.insert("pushSubscriptions", {
        userId,
        ...subscription,
        createdAt: now(),
      });
    }
  },
});

export const unsubscribePush = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .first();
    if (existing) await ctx.db.delete(existing._id);
  },
});

// Manual test push to the calling user's own subscriptions. Lets someone
// verify push delivery end-to-end without waiting for a turn change.
export const sendTestPush = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    await ctx.scheduler.runAfter(0, internal.notify.sendManualPush, {
      userId,
      title: "🦀 Test ping",
      body: "This is a manual test notification from CrabCake. If you see this, iOS push works!",
      url: "/",
    });
    return "sent";
  },
});

// Public, unauthenticated feed of active games — used by the Discord bridge
// bot (CrabCake) to post turn notifications into the group chat. Exposes only
// names + turn state, no auth or private data.
export const getDiscordFeed = query({
  handler: async (ctx) => {
    const games = await ctx.db.query("games").collect();
    const active = games.filter((g) => g.status === "playing");
    const out = [];
    for (const g of active) {
      const players = await ctx.db
        .query("players")
        .withIndex("by_game", (q) => q.eq("gameId", g._id))
        .collect();
      const sorted = [...players].sort((a, b) => a.seatIndex - b.seatIndex);
      const current = sorted[g.turn] ?? null;
      const events = await ctx.db
        .query("events")
        .withIndex("by_game", (q) => q.eq("gameId", g._id))
        .order("desc")
        .take(1);
      const auctions = await ctx.db
        .query("auctions")
        .withIndex("by_game", (q) => q.eq("gameId", g._id))
        .collect();
      const auction = auctions.find((a) => a.status === "active") ?? null;
      let auctionInfo = null;
      if (auction) {
        const bidder = sorted.find((p) => p._id === auction.order[auction.nextIndex]) ?? null;
        auctionInfo = {
          auctionId: auction._id,
          spaceIndex: auction.spaceIndex,
          spaceName: getSpace(auction.spaceIndex).name,
          currentBid: auction.currentBid,
          bidderToAct: bidder?.name ?? null,
          bidDeadline: auction.expiresAt ?? null,
        };
      }
      out.push({
        gameId: g._id,
        name: g.name,
        code: g.code,
        phase: g.phase,
        turnPlayer: current?.name ?? null,
        auction: auctionInfo,
        lastEvent: events[0]?.message ?? null,
        lastEventAt: events[0]?.createdAt ?? 0,
        updatedAt: g.lastActionAt ?? 0,
      });
    }
    return out;
  },
});
