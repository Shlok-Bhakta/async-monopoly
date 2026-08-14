// "My Properties" panel: the current player's owned spaces, grouped by color
// group, with symbols for railroads and utilities. Click a row to open the
// property detail modal (build / sell / mortgage) on the board.

import { SPACES } from "../../convex/monopoly/board";
import { GROUP_COLORS, fmtMoney } from "../lib/game";

const GROUP_ORDER = ["brown", "lightblue", "pink", "orange", "red", "yellow", "green", "darkblue"];

function spaceByIdx(i: number) {
  return SPACES.find((s) => s.index === i)!;
}

function propertySymbol(space: { type: string; index: number }): string | null {
  if (space.type === "railroad") return "🚂";
  if (space.type === "utility") return space.index === 12 ? "⚡" : "💧";
  return null;
}

export interface PropsPanelPlayer {
  _id: string;
  money: number;
  properties: number[];
  houses: { space: number; count: number }[];
  mortgaged: number[];
  bankrupt: boolean;
}

export function PropertiesPanel({ me, onSelect }: { me: PropsPanelPlayer | null | undefined; onSelect: (index: number) => void }) {
  if (!me) return null;
  const owned = me.properties.map(spaceByIdx);
  if (owned.length === 0) {
    return (
      <div className="panel properties-panel properties-empty">
        <div className="panel-title">My deed wallet</div>
        <div className="empty-deed-icon">⌂</div>
        <div className="empty-panel-copy">Your title deeds will live here. Land on an open property to start your portfolio.</div>
      </div>
    );
  }

  const groups = GROUP_ORDER.map((g) => ({
    group: g,
    spaces: owned.filter((s) => s.type === "property" && s.group === g),
  })).filter((x) => x.spaces.length > 0);
  const railroads = owned.filter((s) => s.type === "railroad");
  const utilities = owned.filter((s) => s.type === "utility");

  return (
    <div className="panel properties-panel">
      <div className="properties-heading">
        <div><div className="panel-title">My deed wallet</div><div className="properties-count">{owned.length} propert{owned.length === 1 ? "y" : "ies"}</div></div>
        <div className="properties-value">Portfolio</div>
      </div>
      <div className="properties-deck">
        {groups.flatMap(({ group, spaces }) => spaces.map((space) => (
          <PropertyRow key={space.index} space={space} me={me} onSelect={onSelect} groupColor={GROUP_COLORS[group]} />
        )))}
        {railroads.map((space) => <PropertyRow key={space.index} space={space} me={me} onSelect={onSelect} groupColor="#30343b" />)}
        {utilities.map((space) => <PropertyRow key={space.index} space={space} me={me} onSelect={onSelect} groupColor="#16697a" />)}
      </div>
    </div>
  );
}

function PropertyRow({ space, me, onSelect, groupColor }: { space: any; me: PropsPanelPlayer; onSelect: (index: number) => void; groupColor: string }) {
  const houses = me.houses.find((h) => h.space === space.index)?.count ?? 0;
  const mortgaged = me.mortgaged.includes(space.index);
  const symbol = propertySymbol(space);
  return (
    <button type="button" className={`deed-card${mortgaged ? " is-mortgaged" : ""}`} onClick={() => onSelect(space.index)} title="View title deed">
      <span className="deed-card-band" style={{ background: groupColor }} />
      <span className="deed-card-kicker">Title deed</span>
      <span className="deed-card-name">{symbol && <span>{symbol}</span>}{space.name}</span>
      <span className="deed-card-footer">
        <span>{houses > 0 ? (houses === 5 ? "Hotel" : `${houses} house${houses === 1 ? "" : "s"}`) : "View details"}</span>
        <strong>{mortgaged ? "MORTGAGED" : fmtMoney(space.price ?? 0)}</strong>
      </span>
    </button>
  );
}
