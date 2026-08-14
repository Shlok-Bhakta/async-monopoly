import { useRef } from "react";
import { SPACES, type Space } from "../../convex/monopoly/board";
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
  currentPlayerId?: string;
  myPlayerId?: string;
  lastRoll: number[] | null;
  rollKey?: number;
  onSpaceClick: (index: number) => void;
  selectedSpace: number | null;
  highlighted: number | null;
}

type HouseState = { count: number; owner: string | null; mortgaged: boolean };

const TOKEN_COLORS = ["#ef4444", "#2563eb", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#4d7c0f", "#374151"];
const DIE_PIPS: Record<number, number[]> = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};

function houseMap(players: BoardPlayer[]) {
  const map: Record<number, HouseState> = {};
  for (const player of players) {
    for (const house of player.houses) {
      map[house.space] = {
        count: house.count,
        owner: player._id,
        mortgaged: player.mortgaged.includes(house.space),
      };
    }
    for (const space of player.mortgaged) {
      if (!map[space]) map[space] = { count: 0, owner: player._id, mortgaged: true };
    }
    for (const space of player.properties) {
      if (!map[space]) map[space] = { count: 0, owner: player._id, mortgaged: false };
    }
  }
  return map;
}

function sideFor(index: number) {
  if (index <= 10) return "bottom";
  if (index <= 20) return "right";
  if (index <= 30) return "top";
  return "left";
}

function Tokens({ players, myPlayerId, currentPlayerId }: { players: BoardPlayer[]; myPlayerId?: string; currentPlayerId?: string }) {
  if (!players.length) return null;
  return (
    <div className="token-stack" aria-label={players.map((player) => player.name).join(", ")}>
      {players.map((player) => (
        <span
          key={player._id}
          className={`board-token${player._id === myPlayerId ? " is-mine" : ""}${player._id === currentPlayerId ? " is-current" : ""}`}
          style={{ "--token-color": TOKEN_COLORS[player.seatIndex % TOKEN_COLORS.length] } as React.CSSProperties}
          title={`${player.name}${player._id === myPlayerId ? " (you)" : ""}`}
        >
          {player.token.split(" ")[0]}
        </span>
      ))}
    </div>
  );
}

function SpaceArtwork({ space }: { space: Space }) {
  switch (space.type) {
    case "go":
      return <><span className="corner-kicker">Collect $200</span><span className="corner-word go-word">GO</span><span className="corner-arrow">↙</span></>;
    case "jail":
      return <><span className="corner-icon">🔒</span><span className="corner-word">JAIL</span><span className="corner-kicker">Just visiting</span></>;
    case "casino":
      return <><span className="corner-icon">🎰</span><span className="corner-word">CASINO</span><span className="corner-kicker">Feeling lucky?</span></>;
    case "goToJail":
      return <><span className="corner-icon">👮</span><span className="corner-word">GO TO JAIL</span></>;
    case "tax":
      return <><span className="space-icon">💸</span><span className="space-name">{space.name}</span><span className="space-price">${space.tax}</span></>;
    case "chance":
      return <><span className="card-symbol chance-symbol">?</span><span className="space-name">Chance</span></>;
    case "communityChest":
      return <><span className="card-symbol chest-symbol">✦</span><span className="space-name">Community Chest</span></>;
    case "railroad":
      return <><span className="space-icon">🚂</span><span className="space-name">{space.name}</span><span className="space-price">${space.price}</span></>;
    case "utility":
      return <><span className="space-icon">{space.index === 12 ? "💡" : "💧"}</span><span className="space-name">{space.name}</span><span className="space-price">${space.price}</span></>;
    default:
      return <><span className="space-name">{space.name}</span>{space.price !== undefined && <span className="space-price">${space.price}</span>}</>;
  }
}

function BoardSpace({
  space,
  players,
  house,
  owner,
  isSelected,
  isHighlighted,
  myPlayerId,
  currentPlayerId,
  onClick,
}: {
  space: Space;
  players: BoardPlayer[];
  house?: HouseState;
  owner?: BoardPlayer;
  isSelected: boolean;
  isHighlighted: boolean;
  myPlayerId?: string;
  currentPlayerId?: string;
  onClick: () => void;
}) {
  const { row, col } = spacePos(space.index);
  const isCorner = ["go", "jail", "casino", "goToJail"].includes(space.type);
  return (
    <button
      type="button"
      className={`board-space side-${sideFor(space.index)}${isCorner ? " corner-space" : ""}${isSelected ? " is-selected" : ""}${isHighlighted ? " is-highlighted" : ""}${house?.mortgaged ? " is-mortgaged" : ""}`}
      style={{ gridRow: row + 1, gridColumn: col + 1 }}
      onClick={onClick}
      aria-label={`${space.name}${owner ? `, owned by ${owner.name}` : ""}`}
      data-space={space.index}
    >
      {space.type === "property" && <span className="deed-band" style={{ background: GROUP_COLORS[space.group!] }} />}
      {owner && <span className="owner-mark" style={{ background: TOKEN_COLORS[owner.seatIndex % TOKEN_COLORS.length] }} title={`Owned by ${owner.name}`} />}
      <span className="space-art"><SpaceArtwork space={space} /></span>
      {house && house.count > 0 && (
        <span className="building-row" aria-label={house.count === 5 ? "Hotel" : `${house.count} houses`}>
          {house.count === 5 ? <span className="hotel-pip" /> : Array.from({ length: house.count }, (_, index) => <span key={index} className="house-pip" />)}
        </span>
      )}
      {house?.mortgaged && <span className="mortgage-stamp">M</span>}
      <Tokens players={players} myPlayerId={myPlayerId} currentPlayerId={currentPlayerId} />
    </button>
  );
}

function Die({ value, index, animate }: { value: number; index: number; animate: boolean }) {
  return (
    <div className={`die-face${animate ? " is-rolling" : ""}`} style={{ animationDelay: `${index * 90}ms` }} aria-label={`${value}`}>
      {DIE_PIPS[value].map((position) => <span key={position} className={`pip pip-${position}`} />)}
    </div>
  );
}

export function Board({ players, currentPlayerId, myPlayerId, lastRoll, rollKey, onSpaceClick, selectedSpace, highlighted }: Props) {
  const houses = houseMap(players);
  const scroller = useRef<HTMLDivElement>(null);
  const currentPlayer = players.find((player) => player._id === currentPlayerId);
  const me = players.find((player) => player._id === myPlayerId);

  function focusPlayer(player?: BoardPlayer) {
    if (!player || !scroller.current) return;
    const cell = scroller.current.querySelector<HTMLElement>(`[data-space="${player.position}"]`);
    cell?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  }

  return (
    <section className="board-section" aria-label="Crabopoly board">
      <div className="board-toolbar">
        <div>
          <span className="eyebrow">Board</span>
          <span className="board-turn-label">{currentPlayer ? `${currentPlayer.token.split(" ")[0]} ${currentPlayer.name}'s turn` : "Game in progress"}</span>
        </div>
        <button type="button" className="locate-button" onClick={() => focusPlayer(me)}>◎ Find me</button>
      </div>
      <div className="board-scroll" ref={scroller}>
        <div className="board-shell">
          {SPACES.map((space) => {
            const here = players.filter((player) => player.position === space.index && !player.bankrupt);
            const house = houses[space.index];
            const owner = players.find((player) => player._id === house?.owner);
            return (
              <BoardSpace
                key={space.index}
                space={space}
                players={here}
                house={house}
                owner={owner}
                isSelected={selectedSpace === space.index}
                isHighlighted={highlighted === space.index}
                myPlayerId={myPlayerId}
                currentPlayerId={currentPlayerId}
                onClick={() => onSpaceClick(space.index)}
              />
            );
          })}
          <div className="board-center">
            <div className="center-brand"><span>🦀</span><strong>CRABOPOLY</strong><small>COASTAL EDITION</small></div>
            <div key={rollKey ?? lastRoll?.join("-")} className="dice-row" aria-label={lastRoll ? `Last roll: ${lastRoll.join(" and ")}` : "No roll yet"}>
              {lastRoll ? lastRoll.map((value, index) => <Die key={index} value={value} index={index} animate />) : <><div className="die-face die-empty">?</div><div className="die-face die-empty">?</div></>}
            </div>
            <div className="center-caption">ROLL · DEAL · REEL IT IN</div>
          </div>
        </div>
      </div>
      <div className="board-pan-hint">Swipe the board to explore • tap any deed for details</div>
    </section>
  );
}
