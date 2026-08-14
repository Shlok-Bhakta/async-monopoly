import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ActionBar } from "../src/components/Game";

function player(overrides: Record<string, unknown> = {}) {
  return {
    _id: "player-1",
    name: "Alice",
    money: 1_000,
    stockInvestment: 0,
    stockValue: 0,
    ...overrides,
  };
}

describe("Stock Market action bar", () => {
  it("lets a first-time investor choose an amount within cash on hand", () => {
    const me = player();
    const html = renderToStaticMarkup(
      <ActionBar
        myAction={{ kind: "stockMarket", investment: 0, value: 0 }}
        myTurn={true}
        me={me}
        current={me}
        players={[me]}
        game={{ status: "playing" }}
        onStockMarket={vi.fn()}
      />,
    );

    expect(html).toContain("Stock Market");
    expect(html).toContain('type="number"');
    expect(html).toContain('min="1"');
    expect(html).toContain('max="1000"');
    expect(html).toContain("Invest");
    expect(html).toContain("Skip");
    expect(html).not.toContain("Cash out");
  });

  it("shows current performance with cash-out and invest-more choices", () => {
    const me = player({ money: 700, stockInvestment: 400, stockValue: 500 });
    const html = renderToStaticMarkup(
      <ActionBar
        myAction={{ kind: "stockMarket", investment: 400, value: 500 }}
        myTurn={true}
        me={me}
        current={me}
        players={[me]}
        game={{ status: "playing" }}
        onStockMarket={vi.fn()}
      />,
    );

    expect(html).toContain("$400 invested, now worth $500");
    expect(html).toContain("Invest more");
    expect(html).toContain("Cash out $500");
    expect(html).toContain('max="700"');
  });
});
