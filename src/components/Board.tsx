import { SPACES } from "../../convex/monopoly/board";
import { spacePos, GROUP_COLORS } from "../lib/game";

export interface BoardPlayer {
  _id: string;
  name: string;
  seatIndex: number;
  position: number;
  token: string;
  bankrupt: boolean;
  money: number;
  houses: { space: number; count: number }[];
  mortgaged: number[];
  properties: number[];
  inJail: boolean;
}

interface Props {
  players: BoardPlayer[];
  lastRoll: number[] | null;
  onSpaceClick: (index: number) => void;
  selectedSpace: number | null;
  highlighted: number | null;
}

function houseMap(players: BoardPlayer[]) {
  const m: Record<number, { count: number; owner: string | null; mortgaged: boolean }> = {};
  for (const p of players) {
    for (const h of p.houses) {
      m[h.space] = { count: h.count, owner: p._id, mortgaged: p.mortgaged.includes(h.space) };
    }
    for (const s of p.mortgaged) {
      if (!m[s]) m[s] = { count: 0, owner: p._id, mortgaged: true };
    }
  }
  return m;
}

export function Board({ players, lastRoll, onSpaceClick, selectedSpace, highlighted }: Props) {
  const houses = houseMap(players);
  const cells: React.ReactNode[] = [];

  for (const space of SPACES) {
    const { row, col } = spacePos(space.index);
    const here = players.filter((p) => p.position === space.index);
    const h = houses[space.index];
    const isProperty = space.type === "property";
    const isSelected = selectedSpace === space.index;
    const isHighlighted = highlighted === space.index;

    let content: React.ReactNode;
    if (space.type === "go") {
      content = (
        <div className="corner" style={{ gridRow: row + 1, gridColumn: col + 1 }}>
          <div className="corner-icon">➡️</div>
          <div>GO</div>
          <div className="tiny">Collect $200</div>
        </div>
      );
    } else if (space.type === "jail") {
      content = (
        <div className="corner" style={{ gridRow: row + 1, gridColumn: col + 1 }}>
          <div className="corner-icon">🔒</div>
          <div>JAIL</div>
          <div className="tiny">Just visiting</div>
        </div>
      );
    } else if (space.type === "casino") {
      content = (
        <div className="corner" style={{ gridRow: row + 1, gridColumn: col + 1 }}>
          <div className="corner-icon">🎰</div>
          <div>CASINO</div>
          <div className="tiny">Feeling lucky?</div>
        </div>
      );
    } else if (space.type === "goToJail") {
      content = (
        <div className="corner" style={{ gridRow: row + 1, gridColumn: col + 1 }}>
          <div className="corner-icon">👮</div>
          <div>GO TO</div>
          <div>JAIL</div>
        </div>
      );
    } else if (space.type === "tax") {
      content = (
        <div className="space-cell" style={{ gridRow: row + 1, gridColumn: col + 1 }} onClick={() => onSpaceClick(space.index)}>
          <div className="name" style={{ fontSize: "0.5rem" }}>{space.name}</div>
          <div className="price">${space.tax}</div>
        </div>
      );
    } else if (space.type === "chance") {
      content = (
        <div className="space-cell" style={{ gridRow: row + 1, gridColumn: col + 1 }} onClick={() => onSpaceClick(space.index)}>
          <div className="name" style={{ fontSize: "0.9rem", color: "#c0392b" }}>?</div>
          <div className="name" style={{ fontSize: "0.45rem" }}>Chance</div>
        </div>
      );
    } else if (space.type === "communityChest") {
      content = (
        <div className="space-cell" style={{ gridRow: row + 1, gridColumn: col + 1 }} onClick={() => onSpaceClick(space.index)}>
          <div className="name" style={{ fontSize: "0.9rem", color: "#2563eb" }}>✦</div>
          <div className="name" style={{ fontSize: "0.45rem" }}>Community Chest</div>
        </div>
      );
    } else if (space.type === "railroad") {
      content = (
        <div className="space-cell" style={{ gridRow: row + 1, gridColumn: col + 1 }} onClick={() => onSpaceClick(space.index)}>
          <div className="name" style={{ fontSize: "0.75rem" }}>🚂</div>
          <div className="name">{space.name}</div>
          <div className="price">${space.price}</div>
        </div>
      );
    } else if (space.type === "utility") {
      content = (
        <div className="space-cell" style={{ gridRow: row + 1, gridColumn: col + 1 }} onClick={() => onSpaceClick(space.index)}>
          <div className="name" style={{ fontSize: "0.75rem" }}>{space.index === 12 ? "⚡" : "💧"}</div>
          <div className="name">{space.name}</div>
          <div className="price">${space.price}</div>
        </div>
      );
    } else if (isProperty) {
      content = (
        <div
          className="space-cell"
          style={{
            gridRow: row + 1,
            gridColumn: col + 1,
            boxShadow: isSelected ? "inset 0 0 0 3px var(--gold)" : undefined,
          }}
          onClick={() => onSpaceClick(space.index)}
        >
          <div className="color-bar" style={{ background: GROUP_COLORS[space.group!] }} />
          <div className="name">{space.name}</div>
          {h && h.count > 0 && (
            <div className="house-row">
              {h.count === 5 ? (
                <div className="hotel-pip" />
              ) : (
                Array.from({ length: h.count }).map((_, i) => <div key={i} className="house-pip" />)
              )}
            </div>
          )}
          <div className="price">${space.price}</div>
          {h?.mortgaged && <div className="mortgaged-x">✕</div>}
          {here.length > 0 && (
            <div className="token-stack">
              {here.map((p) => (
                <span key={p._id} className="token" style={{ opacity: p.bankrupt ? 0.35 : 1 }} title={p.name}>
                  {p.token.split(" ")[0]}
                </span>
              ))}
            </div>
          )}
          {isHighlighted && !isSelected && (
            <div style={{ position: "absolute", inset: 0, boxShadow: "inset 0 0 0 3px var(--gold)", pointerEvents: "none" }} />
          )}
        </div>
      );
    } else {
      content = (
        <div className="space-cell" style={{ gridRow: row + 1, gridColumn: col + 1 }} onClick={() => onSpaceClick(space.index)}>
          <div className="name">{space.name}</div>
        </div>
      );
    }
    cells.push(<div key={space.index} style={{ display: "contents" }}>{content}</div>);
  }

  return (
    <div className="board-shell">
      {cells}
      <div className="board-center">
        <div className="center-logo">Crabopoly</div>
        <div className="dice-row">
          {lastRoll ? (
            lastRoll.map((d, i) => (
              <div key={i} className={`die ${lastRoll[0] === lastRoll[1] ? "doubles" : ""}`}>{d}</div>
            ))
          ) : (
            <>
              <div className="die" style={{ opacity: 0.4 }}>?</div>
              <div className="die" style={{ opacity: 0.4 }}>?</div>
            </>
          )}
        </div>
        <div className="center-tagline">Async Monopoly for the group chat</div>
      </div>
    </div>
  );
}
