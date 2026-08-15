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

describe("PropertyModal classic monopoly rent", () => {
  it("shows doubled base rent only for the property's completed color set", () => {
    const html = renderProperty(1, "manage", owner({ properties: [1, 3] }));

    expect(html).toContain("Unimproved base rent is doubled");
    expect(html).toContain("Base rent (monopoly)");
    expect(html).toContain("$4");
  });
});
