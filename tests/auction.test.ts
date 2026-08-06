// Unit tests for the auction state machine (convex/monopoly/auction.ts).
//
// The auction logic is pure and dependency-free so we can exercise every
// bidding/passing sequence without Convex. The regression test at the bottom
// covers the deadlock: a lone remaining bidder with no bid yet must still get
// a chance to act instead of the auction silently ending.

import { describe, expect, it } from "vitest";
import {
  advanceExpired,
  bid,
  buildBiddingOrder,
  createAuction,
  currentBidderId,
  dropUnaffordable,
  maybeFinish,
  minBid,
  pass,
} from "../convex/monopoly/auction";

const A = "player-a";
const B = "player-b";
const C = "player-c";

describe("createAuction", () => {
  it("starts active with no bid and the first order entry to act", () => {
    const s = createAuction([A, B, C], 24);
    expect(s.status).toBe("active");
    expect(s.spaceIndex).toBe(24);
    expect(s.currentBid).toBe(0);
    expect(s.currentBidder).toBeUndefined();
    expect(currentBidderId(s)).toBe(A);
  });
});

describe("buildBiddingOrder", () => {
  const players = [
    { _id: A, seatIndex: 0 },
    { _id: B, seatIndex: 1 },
    { _id: C, seatIndex: 2 },
  ];

  it("puts the player after the turn player first, decliner last", () => {
    // A's turn, A declines: B, C, A
    expect(buildBiddingOrder(players, 0)).toEqual([B, C, A]);
    // B's turn, B declines: C, A, B
    expect(buildBiddingOrder(players, 1)).toEqual([C, A, B]);
    // C's turn, C declines: A, B, C
    expect(buildBiddingOrder(players, 2)).toEqual([A, B, C]);
  });

  it("works when the turn player is the last seat (wrap-around case)", () => {
    const s = buildBiddingOrder(players, 2);
    expect(s[s.length - 1]).toBe(C); // decliner bids last
    expect(s).toHaveLength(3);
  });

  it("sorts by seat index regardless of input order", () => {
    expect(buildBiddingOrder([players[2], players[0], players[1]], 0)).toEqual([B, C, A]);
  });
});

describe("bid", () => {
  it("records the bid and advances to the next bidder", () => {
    const s = createAuction([A, B, C]);
    const next = bid(s, A, 50, 200);
    expect(next.currentBid).toBe(50);
    expect(next.currentBidder).toBe(A);
    expect(currentBidderId(next)).toBe(B);
  });

  it("wraps around to the first bidder after the last", () => {
    let s = createAuction([A, B]);
    s = bid(s, A, 10, 100);
    s = bid(s, B, 20, 100);
    expect(currentBidderId(s)).toBe(A);
  });

  it("rejects a bid from someone who is not the current bidder", () => {
    const s = createAuction([A, B]);
    expect(() => bid(s, B, 10, 100)).toThrow("Not your bid");
  });

  it("rejects a bid below the percentage-based minimum raise", () => {
    let s = createAuction([A, B]);
    s = bid(s, A, 100, 500);
    // After $100, the minimum raise is 5%: next bid must be >= $105.
    expect(() => bid(s, B, 101, 500)).toThrow("Bid must be at least $105");
    expect(() => bid(s, B, 104, 500)).toThrow("Bid must be at least $105");
    expect(bid(s, B, 105, 500).currentBid).toBe(105);
  });

  it("minBid scales naturally: small raises at low bids, big raises at high bids", () => {
    expect(minBid(createAuction([A]))).toBe(1);
    expect(minBid({ ...createAuction([A]), currentBid: 10 })).toBe(11);
    expect(minBid({ ...createAuction([A]), currentBid: 100 })).toBe(105);
    expect(minBid({ ...createAuction([A]), currentBid: 304 })).toBe(320);
    expect(minBid({ ...createAuction([A]), currentBid: 1000 })).toBe(1050);
  });

  it("rejects a bid the player cannot afford", () => {
    const s = createAuction([A, B]);
    expect(() => bid(s, A, 101, 100)).toThrow("cannot afford");
  });

  it("rejects actions on a finished auction", () => {
    let s = createAuction([A, B]);
    s = bid(s, A, 50, 100);
    s = pass(s, B);
    const result = maybeFinish(s);
    expect(result).not.toBeNull();
    const done = { ...s, status: "done" as const };
    expect(() => bid(done, A, 60, 100)).toThrow("Auction is over");
    expect(() => pass(done, A)).toThrow("Auction is over");
  });
});

describe("pass", () => {
  it("removes the passer and keeps the same index (next player steps up)", () => {
    const s = createAuction([A, B, C]);
    // A passes -> B's turn
    const next = pass(s, A);
    expect(next.order).toEqual([B, C]);
    expect(currentBidderId(next)).toBe(B);
    // B passes -> C's turn (index 0 after shrink)
    const next2 = pass(next, B);
    expect(next2.order).toEqual([C]);
    expect(currentBidderId(next2)).toBe(C);
  });

  it("wraps to 0 when the tail passes", () => {
    let s = createAuction([A, B, C]);
    s = bid(s, A, 10, 100); // B's turn
    s = pass(s, B); // remaining [A, C], index 1 -> C
    expect(currentBidderId(s)).toBe(C);
    s = pass(s, C); // remaining [A], index 0 -> A
    expect(currentBidderId(s)).toBe(A);
  });

  it("rejects a pass from someone who is not the current bidder", () => {
    const s = createAuction([A, B]);
    expect(() => pass(s, B)).toThrow("Not your turn to bid");
  });
});

describe("maybeFinish", () => {
  it("continues while more than one bidder remains", () => {
    const s = createAuction([A, B, C]);
    expect(maybeFinish(s)).toBeNull();
    const afterBid = bid(s, A, 10, 100);
    expect(maybeFinish(afterBid)).toBeNull();
  });

  it("ends with no sale when everyone passes before any bid", () => {
    let s = createAuction([A, B]);
    s = pass(s, A);
    s = pass(s, B);
    expect(maybeFinish(s)).toEqual({ winningBid: 0, sold: false });
  });

  it("crowns the last remaining bidder who placed a bid", () => {
    let s = createAuction([A, B, C]);
    s = bid(s, A, 100, 500);
    s = pass(s, B);
    s = pass(s, C);
    expect(maybeFinish(s)).toEqual({ winnerId: A, winningBid: 100, sold: true });
  });

  it("crowns the high bidder when everyone else passes", () => {
    let s = createAuction([A, B, C]);
    s = bid(s, A, 100, 500);
    s = bid(s, B, 200, 500);
    s = pass(s, C);
    s = pass(s, A);
    expect(maybeFinish(s)).toEqual({ winnerId: B, winningBid: 200, sold: true });
  });

  it("REGRESSION: a lone remaining bidder with no bid yet still gets to act", () => {
    // B (first in order) passes, then C passes. A is left with the auction
    // still open at $0 — A must be able to bid for the property, not have the
    // auction silently end with "no sale".
    let s = createAuction([B, C, A]);
    s = pass(s, B);
    s = pass(s, C);
    expect(s.order).toEqual([A]);
    expect(maybeFinish(s)).toBeNull(); // must NOT end here
    // A can now bid the starting price and win.
    s = bid(s, A, 10, 100);
    expect(maybeFinish(s)).toEqual({ winnerId: A, winningBid: 10, sold: true });
    // ...or pass, which ends with no sale.
    let s2 = createAuction([B, C, A]);
    s2 = pass(s2, B);
    s2 = pass(s2, C);
    s2 = pass(s2, A);
    expect(maybeFinish(s2)).toEqual({ winningBid: 0, sold: false });
  });

  it("REGRESSION: full 3-player flow cannot deadlock (everyone has a turn)", () => {
    // Realistic sequence: A declines (bids last). B passes, C passes,
    // A bids and wins.
    let s = createAuction([B, C, A]);
    s = pass(s, B);
    s = pass(s, C);
    expect(maybeFinish(s)).toBeNull();
    s = bid(s, A, 10, 100);
    const result = maybeFinish(s);
    expect(result).toEqual({ winnerId: A, winningBid: 10, sold: true });
  });
});

describe("dropUnaffordable", () => {
  it("removes players who can't cover the next minimum bid", () => {
    let s = createAuction([A, B, C]);
    s = bid(s, A, 100, 500); // B's turn, min next = $105
    const money = { [A]: 400, [B]: 104, [C]: 999 };
    const next = dropUnaffordable(s, money);
    // B can't afford $105 and is gone; A and C remain. Index stays on C? B was
    // at index 1; after removal the array is [A, C] and index 1 points at C.
    expect(next.order).toEqual([A, C]);
    expect(currentBidderId(next)).toBe(C);
  });

  it("keeps the current bidder (they always can afford their own bid)", () => {
    let s = createAuction([A, B]);
    s = bid(s, A, 100, 500); // B to act, min $105
    const money = { [A]: 100, [B]: 500 }; // A bid exactly what they had
    const next = dropUnaffordable(s, money);
    expect(next.order).toEqual([A, B]);
  });
});

describe("advanceExpired", () => {
  const T0 = 1_700_000_000_000;
  // The bidder's window runs from their turn start + 2h, so "past" must be
  // after that deadline (not before the bid was made).
  const past = T0 + 2 * 60 * 60 * 1000 + 1000;
  const future = T0 + 2 * 60 * 60 * 1000 - 1000;

  it("auto-passes the current bidder after the deadline and refreshes the clock", () => {
    let s = createAuction([A, B, C], 0, T0);
    s = bid(s, A, 100, 500, T0); // B's turn
    expect(currentBidderId(s)).toBe(B);
    const advanced = advanceExpired(s, past);
    expect(advanced.order).toEqual([A, C]);
    expect(currentBidderId(advanced)).toBe(C);
    expect(advanced.expiresAt).toBe(past + 2 * 60 * 60 * 1000);
  });

  it("no-ops before the deadline", () => {
    let s = createAuction([A, B], 0, T0);
    s = bid(s, A, 100, 500, T0);
    const advanced = advanceExpired(s, future);
    expect(advanced).toBe(s);
  });
});
