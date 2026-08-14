import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  data: null as any,
  mutation: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: () => mocks.data,
  useMutation: () => mocks.mutation,
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ gameId: "game-1" }),
}));

import { Game } from "../src/components/Game";

describe("Game Stock Market phase", () => {
  it("routes the live phase data into the current player's market controls", () => {
    const alice = {
      _id: "player-1",
      name: "Alice",
      money: 700,
      stockInvestment: 400,
      stockValue: 500,
      seatIndex: 0,
      token: "🚗 Car",
      position: 38,
      inJail: false,
      bankrupt: false,
      getOutOfJailCards: 0,
      properties: [],
      houses: [],
      mortgaged: [],
    };
    mocks.data = {
      game: {
        _id: "game-1",
        name: "Market game",
        code: "STOCKS",
        status: "playing",
        turn: 0,
        phase: "stockMarket",
        phaseData: { investment: 400, value: 500 },
        lastActionAt: 1,
      },
      players: [alice],
      myPlayerId: alice._id,
      events: [],
      pendingTrades: [],
      auction: null,
      houseSupply: 32,
      hotelSupply: 12,
    };

    const html = renderToStaticMarkup(<Game />);

    expect(html).toContain("$400 invested, now worth $500");
    expect(html).toContain("Cash out $500");
    expect(html).toContain("Market $500");
  });
});
