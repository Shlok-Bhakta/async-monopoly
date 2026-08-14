import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PropertyModal } from "../src/components/Game";

function owner(overrides: Record<string, unknown> = {}) {
  return {
    _id: "player-1",
    name: "Alice",
    money: 1_000,
    position: 0,
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

describe("PropertyModal house-building actions", () => {
  it("hides building and explains why when the player is off the property's color set", () => {
    const html = renderProperty(1, "manage", owner({
      position: 6,
      properties: [1, 3],
    }));

    expect(html).not.toContain("Build house ($50)");
    expect(html).toContain("Land on any property in this color set to build here.");
  });

  it("offers the unchanged price while the player is on another property in the color set", () => {
    const html = renderProperty(1, "manage", owner({
      position: 3,
      properties: [1, 3],
    }));

    expect(html).toContain("Build house ($50)");
    expect(html).not.toContain("Land on any property in this color set to build here.");
  });
});

describe("PropertyModal monopoly portfolio rent", () => {
  it("shows the owner's 5% monopoly bonus in the displayed rent calculation", () => {
    const html = renderProperty(24, "manage", owner({ properties: [1, 3, 24] }));

    expect(html).toContain("Monopoly portfolio bonus: +5% (1 monopoly)");
    expect(html).toContain("Rent with bonus");
    expect(html).toContain("$21");
    expect(html).not.toContain("With color group (no houses)");
  });
});
