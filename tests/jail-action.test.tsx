import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ActionBar } from "../src/components/Game";

describe("jail action bar", () => {
  it("shows the standard bail for a first visit", () => {
    const me = {
      _id: "player-1",
      name: "Alice",
      money: 1_000,
      inJail: true,
      jailVisits: 1,
      getOutOfJailCards: 0,
    };

    const html = renderToStaticMarkup(
      <ActionBar
        myAction={{ kind: "jail" }}
        myTurn={true}
        me={me}
        current={me}
        players={[me]}
        game={{ status: "playing" }}
        onJail={vi.fn()}
      />,
    );

    expect(html).toContain("Pay $50");
  });

  it("shows the increased bail for a repeat visit", () => {
    const me = {
      _id: "player-1",
      name: "Alice",
      money: 1_000,
      inJail: true,
      jailVisits: 2,
      getOutOfJailCards: 0,
    };

    const html = renderToStaticMarkup(
      <ActionBar
        myAction={{ kind: "jail" }}
        myTurn={true}
        me={me}
        current={me}
        players={[me]}
        game={{ status: "playing" }}
        onJail={vi.fn()}
      />,
    );

    expect(html).toContain("Pay $100");
    expect(html).not.toContain("Pay $50");
  });
});
