import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PropertyModal } from "../src/components/Game";

function owner(overrides: Record<string, unknown> = {}) {
  return {
    _id: "player-1",
    name: "Alice",
    money: 1_000,
    properties: [5, 12],
    houses: [],
    mortgaged: [],
    ...overrides,
  };
}

function renderProperty(space: number, phase: string, me = owner(), gameStatus = "playing") {
  return renderToStaticMarkup(
    <PropertyModal
      space={space}
      players={[me]}
      me={me}
      myTurn={true}
      phase={phase}
      gameStatus={gameStatus}
      houseSupply={32}
      hotelSupply={12}
      onClose={vi.fn()}
      onBuild={vi.fn()}
      onSellHouse={vi.fn()}
      onMortgage={vi.fn()}
      onUnmortgage={vi.fn()}
    />,
  );
}

describe("PropertyModal mortgage actions", () => {
  it("offers mortgage on an owned railroad before the player rolls", () => {
    const html = renderProperty(5, "roll");

    expect(html).toContain("Mortgage (get $100)");
    expect(html).not.toContain("You can manage this on your turn");
  });

  it("offers the existing interest-priced unmortgage action for a utility", () => {
    const html = renderProperty(12, "manage", owner({ mortgaged: [12] }));

    expect(html).toContain("Unmortgage ($83)");
  });

  it("does not offer mortgage after the game has finished", () => {
    const html = renderProperty(5, "gameOver", owner(), "finished");

    expect(html).not.toContain("Mortgage (get $100)");
  });
});
