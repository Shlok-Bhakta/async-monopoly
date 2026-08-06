// Pure auction state machine for Monopoly auctions.
//
// Mutations in convex/game.ts apply these functions to Convex docs.
// This module is deliberately dependency-free (no Convex imports) so it can
// be unit tested with plain vitest — see tests/auction.test.ts.
//
// Speed design (async games):
//  - MIN_BID_INCREMENT stops the $1 staircase that drags auctions on forever.
//  - dropUnaffordable() removes players who can't cover the next minimum bid,
//    so broke players never block the bidding order.
//  - AUCTION_TURN_TIMEOUT_MS gives each bidder a deadline; advanceExpired()
//    auto-passes the current bidder when it lapses so an AFK player can't
//    stall an auction indefinitely.

export const MIN_BID_INCREMENT_PERCENT = 0.05;
export const AUCTION_TURN_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours per bidder turn

export interface AuctionState<T extends string = string> {
  spaceIndex: number;
  currentBid: number;
  /** Player id of whoever made the current bid (undefined before first bid). */
  currentBidder?: T;
  /** Player ids still in the auction, in bidding order. */
  order: T[];
  /** Index into `order` whose turn it is to act. */
  nextIndex: number;
  status: "active" | "done";
  /** Epoch ms when the current bidder's turn expires (auto-pass). */
  expiresAt: number;
}

export interface AuctionResult<T extends string = string> {
  winnerId?: T;
  winningBid: number;
  sold: boolean;
}

/** Start an auction with the given bidding order (first id bids first). */
export function createAuction<T extends string = string>(
  order: T[],
  spaceIndex = 0,
  now = Date.now(),
): AuctionState<T> {
  return {
    spaceIndex,
    currentBid: 0,
    currentBidder: undefined,
    order,
    nextIndex: 0,
    status: "active",
    expiresAt: now + AUCTION_TURN_TIMEOUT_MS,
  };
}

/** Player id whose turn it is to bid/pass, or undefined when empty. */
export function currentBidderId<T extends string = string>(state: AuctionState<T>): T | undefined {
  return state.order[state.nextIndex];
}

/** The smallest legal bid given the current state. */
export function minBid<T extends string = string>(state: AuctionState<T>): number {
  if (state.currentBid === 0) return 1;
  // Percentage-based scaling: each raise must be at least 5% of the current
  // bid, rounded up. +$1 staircasing is impossible once the bid climbs.
  return Math.max(1, Math.ceil(state.currentBid * (1 + MIN_BID_INCREMENT_PERCENT)));
}

/** Record a bid from the current bidder. Throws on invalid moves. */
export function bid<T extends string = string>(
  state: AuctionState<T>,
  playerId: T,
  amount: number,
  money: number,
  now = Date.now(),
): AuctionState<T> {
  if (state.status !== "active") throw new Error("Auction is over");
  if (currentBidderId(state) !== playerId) throw new Error("Not your bid");
  const min = minBid(state);
  if (amount < min) throw new Error(`Bid must be at least $${min}`);
  if (amount > money) throw new Error("You cannot afford that bid");
  const nextIndex = state.order.length === 0 ? 0 : (state.nextIndex + 1) % state.order.length;
  return { ...state, currentBid: amount, currentBidder: playerId, nextIndex, expiresAt: now + AUCTION_TURN_TIMEOUT_MS };
}

/** Current bidder drops out. Throws on invalid moves. */
export function pass<T extends string = string>(
  state: AuctionState<T>,
  playerId: T,
  now = Date.now(),
): AuctionState<T> {
  if (state.status !== "active") throw new Error("Auction is over");
  if (currentBidderId(state) !== playerId) throw new Error("Not your turn to bid");
  const remaining = state.order.filter((id) => id !== playerId);
  // The array shrank: keep the same index (it now points at the next player),
  // wrapping to 0 if we removed the tail or the list is empty.
  const nextIndex = remaining.length === 0 ? 0 : state.nextIndex >= remaining.length ? 0 : state.nextIndex;
  return { ...state, order: remaining, nextIndex, expiresAt: now + AUCTION_TURN_TIMEOUT_MS };
}

/**
 * Remove players who can't afford the next minimum bid. They could never bid
 * again anyway (every future bid is >= the current minimum), so dropping them
 * keeps the auction from waiting on people who can only pass.
 *
 * The current high bidder is NEVER removed: if everyone else passes, they win
 * at their bid even though they can't afford to raise.
 */
export function dropUnaffordable<T extends string = string>(
  state: AuctionState<T>,
  moneyById: Record<string, number>,
): AuctionState<T> {
  if (state.status !== "active" || state.order.length === 0) return state;
  const min = minBid(state);
  const remaining = state.order.filter(
    (id) => id === state.currentBidder || (moneyById[id as string] ?? 0) >= min,
  );
  const nextIndex = remaining.length === 0 ? 0 : state.nextIndex >= remaining.length ? 0 : state.nextIndex;
  return { ...state, order: remaining, nextIndex };
}

/**
 * If the current bidder's deadline has passed, auto-pass them (and refresh the
 * clock for whoever is next). Returns the same state when nothing is expired.
 */
export function advanceExpired<T extends string = string>(
  state: AuctionState<T>,
  now = Date.now(),
): AuctionState<T> {
  if (state.status !== "active" || state.order.length === 0) return state;
  if (now < state.expiresAt) return state;
  const current = currentBidderId(state);
  if (!current) return state;
  return pass(state, current, now);
}

/**
 * Returns a result when the auction is over, or null when it must continue.
 *
 * A lone remaining bidder who hasn't bid yet (currentBid === 0) still gets a
 * chance to bid or pass — ending the auction there is the classic bug where
 * the last player never gets to buy the property at the starting price.
 */
export function maybeFinish<T extends string = string>(state: AuctionState<T>): AuctionResult<T> | null {
  if (state.status !== "active") return null;
  if (state.order.length === 0) {
    // Everyone passed before anyone bid.
    return { winningBid: 0, sold: false };
  }
  if (state.order.length === 1) {
    if (state.currentBid > 0) {
      // Last bidder standing takes it at their bid.
      return { winnerId: state.order[0], winningBid: state.currentBid, sold: true };
    }
    // One bidder left, nobody has bid yet: let them act.
    return null;
  }
  return null;
}

/**
 * Build the bidding order for a property auction: all alive players in seat
 * order, starting with the player after the current turn player and ending
 * with the turn player (the decliner) last.
 */
export function buildBiddingOrder<T extends string>(
  players: { _id: T; seatIndex: number }[],
  turnSeatIndex: number,
): T[] {
  const sorted = [...players].sort((a, b) => a.seatIndex - b.seatIndex);
  const startIdx = sorted.findIndex((p) => p.seatIndex === turnSeatIndex);
  return [...sorted.slice(startIdx + 1), ...sorted.slice(0, startIdx + 1)].map((p) => p._id);
}
