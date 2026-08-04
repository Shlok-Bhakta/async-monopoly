// Pure auction state machine for Monopoly auctions.
//
// Mutations in convex/game.ts apply these functions to Convex docs.
// This module is deliberately dependency-free (no Convex imports) so it can
// be unit tested with plain vitest — see tests/auction.test.ts.

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
}

export interface AuctionResult<T extends string = string> {
  winnerId?: T;
  winningBid: number;
  sold: boolean;
}

/** Start an auction with the given bidding order (first id bids first). */
export function createAuction<T extends string = string>(order: T[], spaceIndex = 0): AuctionState<T> {
  return {
    spaceIndex,
    currentBid: 0,
    currentBidder: undefined,
    order,
    nextIndex: 0,
    status: "active",
  };
}

/** Player id whose turn it is to bid/pass, or undefined when empty. */
export function currentBidderId<T extends string = string>(state: AuctionState<T>): T | undefined {
  return state.order[state.nextIndex];
}

/** Record a bid from the current bidder. Throws on invalid moves. */
export function bid<T extends string = string>(
  state: AuctionState<T>,
  playerId: T,
  amount: number,
  money: number,
): AuctionState<T> {
  if (state.status !== "active") throw new Error("Auction is over");
  if (currentBidderId(state) !== playerId) throw new Error("Not your bid");
  if (amount <= state.currentBid) throw new Error("Bid must be higher than current bid");
  if (amount > money) throw new Error("You cannot afford that bid");
  const nextIndex = state.order.length === 0 ? 0 : (state.nextIndex + 1) % state.order.length;
  return { ...state, currentBid: amount, currentBidder: playerId, nextIndex };
}

/** Current bidder drops out. Throws on invalid moves. */
export function pass<T extends string = string>(state: AuctionState<T>, playerId: T): AuctionState<T> {
  if (state.status !== "active") throw new Error("Auction is over");
  if (currentBidderId(state) !== playerId) throw new Error("Not your turn to bid");
  const remaining = state.order.filter((id) => id !== playerId);
  // The array shrank: keep the same index (it now points at the next player),
  // wrapping to 0 if we removed the tail or the list is empty.
  const nextIndex = remaining.length === 0 ? 0 : state.nextIndex >= remaining.length ? 0 : state.nextIndex;
  return { ...state, order: remaining, nextIndex };
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
