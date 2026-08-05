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
      <div className="panel">
        <div className="panel-title">My Properties</div>
        <div className="muted tiny">You don't own anything yet — land on something and buy it!</div>
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
    <div className="panel">
      <div className="panel-title">My Properties ({owned.length})</div>
      {groups.map(({ group, spaces }) => (
        <div key={group}>
          <div className="prop-group-label" style={{ background: GROUP_COLORS[group] }}>
            {group}
          </div>
          {spaces.map((s) => (
            <PropertyRow key={s.index} space={s} me={me} onSelect={onSelect} />
          ))}
        </div>
      ))}
      {railroads.length > 0 && (
        <div>
          <div className="prop-group-label" style={{ background: "#444" }}>Railroads</div>
          {railroads.map((s) => (
            <PropertyRow key={s.index} space={s} me={me} onSelect={onSelect} />
          ))}
        </div>
      )}
      {utilities.length > 0 && (
        <div>
          <div className="prop-group-label" style={{ background: "#444" }}>Utilities</div>
          {utilities.map((s) => (
            <PropertyRow key={s.index} space={s} me={me} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}

function PropertyRow({ space, me, onSelect }: { space: any; me: PropsPanelPlayer; onSelect: (index: number) => void }) {
  const houses = me.houses.find((h) => h.space === space.index)?.count ?? 0;
  const mortgaged = me.mortgaged.includes(space.index);
  const symbol = propertySymbol(space);
  const swatch = space.type === "property" && space.group ? GROUP_COLORS[space.group] : "#555";
  return (
    <div className={`prop-row${mortgaged ? " mortgaged" : ""}`} onClick={() => onSelect(space.index)} title="Click for details">
      <span className="prop-color" style={{ background: swatch }} />
      {symbol ? <span className="prop-symbol">{symbol}</span> : <span className="prop-symbol" />}
      <span className="prop-name">{space.name}</span>
      {houses > 0 && <span className="prop-houses">{houses === 5 ? "🏨" : "🏠".repeat(houses)}</span>}
      <span className="prop-price">{mortgaged ? "MORTGAGED" : fmtMoney(space.price ?? 0)}</span>
    </div>
  );
}
