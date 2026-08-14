import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useQuery: vi.fn(),
}));

import { TradeModal } from "../src/components/Game";

describe("TradeModal", () => {
  it("excludes mortgaged deeds and shows that neither side has tradable deeds", () => {
    const alice = {
      _id: "player-1",
      name: "Alice",
      money: 1_000,
      bankrupt: false,
      properties: [5],
      houses: [],
      mortgaged: [5],
    };
    const bob = {
      _id: "player-2",
      name: "Bob",
      money: 1_000,
      bankrupt: false,
      properties: [3],
      houses: [],
      mortgaged: [3],
    };

    const html = renderToStaticMarkup(
      <TradeModal
        players={[alice, bob]}
        meId={alice._id}
        gameId="game-1"
        onClose={vi.fn()}
        onError={vi.fn()}
      />,
    );

    expect(html).not.toContain("Reading Railroad");
    expect(html).not.toContain("Baltic Avenue");
    expect(html.match(/No tradable deeds/g)).toHaveLength(2);
  });
});
