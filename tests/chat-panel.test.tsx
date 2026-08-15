import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useQuery: vi.fn(),
}));

import { ChatPanel } from "../src/components/Game";

describe("ChatPanel", () => {
  it("renders player messages, identifies the current player's message, and escapes message markup", () => {
    const html = renderToStaticMarkup(
      <ChatPanel
        messages={[
          { _id: "message-1", playerId: "player-1", playerName: "Alice", message: "Your turn", createdAt: 1 },
          { _id: "message-2", playerId: "player-2", playerName: "Bob", message: "<b>Deal?</b>", createdAt: 2 },
        ]}
        meId="player-1"
        onSend={vi.fn()}
        onError={vi.fn()}
      />,
    );

    expect(html).toContain("Game chat");
    expect(html).toContain('class="chat-message is-mine"');
    expect(html).toContain("Alice");
    expect(html).toContain("Bob");
    expect(html).toContain("&lt;b&gt;Deal?&lt;/b&gt;");
    expect(html).not.toContain("<b>Deal?</b>");
    expect(html).toMatch(/max[Ll]ength="500"/);
  });

  it("shows an empty state when nobody has sent a message", () => {
    const html = renderToStaticMarkup(
      <ChatPanel messages={[]} meId="player-1" onSend={vi.fn()} onError={vi.fn()} />,
    );

    expect(html).toContain("No messages yet. Say hello!");
  });
});
