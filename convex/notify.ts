"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import webpush from "web-push";

// Node-only file: web-push needs node built-ins (http/https/crypto).
// All DB access happens through notifyDb (internal queries/mutations).

async function sendToUser(ctx: any, userId: Id<"users">, title: string, body: string, url: string) {
  const subs = await ctx.runQuery(internal.notifyDb.getSubscriptions, { userId });
  if (!subs || subs.length === 0) return;
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) {
    console.error("VAPID env vars not configured");
    return;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({ title, body, url }),
      );
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        // Subscription expired/removed on the device — clean it up.
        await ctx.runMutation(internal.notifyDb.deleteSubscription, { id: sub._id });
      } else {
        console.error("Push send failed:", err?.statusCode, err?.message);
      }
    }
  }
}

export const sendManualPush = internalAction({
  args: {
    userId: v.id("users"),
    title: v.string(),
    body: v.string(),
    url: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await sendToUser(ctx, args.userId, args.title, args.body, args.url ?? "/");
  },
});

export const notifyCurrentTurn = internalAction({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    try {
      const { game, players } = await ctx.runQuery(internal.notifyDb.getGameState, { gameId });
      if (!game || game.status !== "playing") return;
      const current = players[game.turn];
      if (!current || current.bankrupt) return;
      await sendToUser(
        ctx,
        current.userId,
        "🎲 It's your turn!",
        `Your turn in ${game.name} — roll the dice!`,
        `/game/${gameId}`,
      );
    } catch (err) {
      console.error("notifyCurrentTurn failed:", err);
    }
  },
});

export const notifyTrade = internalAction({
  args: {
    gameId: v.id("games"),
    toPlayerId: v.id("players"),
    fromName: v.string(),
  },
  handler: async (ctx, { gameId, toPlayerId, fromName }) => {
    try {
      const { game } = await ctx.runQuery(internal.notifyDb.getGameState, { gameId });
      const to = await ctx.runQuery(internal.notifyDb.getPlayer, { playerId: toPlayerId });
      if (!game || !to) return;
      await sendToUser(
        ctx,
        to.userId,
        "💱 Trade offer",
        `${fromName} sent you a trade offer in ${game.name}`,
        `/game/${gameId}`,
      );
    } catch (err) {
      console.error("notifyTrade failed:", err);
    }
  },
});

export const notifyGameStarted = internalAction({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    try {
      const { game, players } = await ctx.runQuery(internal.notifyDb.getGameState, { gameId });
      if (!game || game.status !== "playing") return;
      const first = players[game.turn];
      if (!first || first.bankrupt) return;
      await sendToUser(
        ctx,
        first.userId,
        "🏁 Game started!",
        `${game.name} is live — it's your turn first!`,
        `/game/${gameId}`,
      );
    } catch (err) {
      console.error("notifyGameStarted failed:", err);
    }
  },
});
