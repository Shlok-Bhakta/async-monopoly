import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { getSpace } from "../../convex/monopoly/board";
import { fmtMoney, GROUP_COLORS } from "../lib/game";
import { Board } from "./Board";

export function Game() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const data = useQuery(api.game.getGame, { gameId: gameId as any });

  const [selected, setSelected] = useState<number | null>(null);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startGame = useMutation(api.game.startGame);
  const leaveGame = useMutation(api.game.leaveGame);
  const roll = useMutation(api.game.roll);
  const jailAction = useMutation(api.game.jailAction);
  const buyProperty = useMutation(api.game.buyProperty);
  const declineBuy = useMutation(api.game.declineBuy);
  const endTurn = useMutation(api.game.endTurn);
  const settleDebt = useMutation(api.game.settleDebt);
  const declareBankruptcy = useMutation(api.game.declareBankruptcy);
  const buildHouse = useMutation(api.game.buildHouse);
  const sellHouse = useMutation(api.game.sellHouse);
  const mortgage = useMutation(api.game.mortgage);
  const unmortgage = useMutation(api.game.unmortgage);
  const auctionBid = useMutation(api.game.auctionBid);
  const auctionPass = useMutation(api.game.auctionPass);
  const casinoAction = useMutation(api.game.casinoAction);
  const respondTrade = useMutation(api.game.respondTrade);
  const cancelTrade = useMutation(api.game.cancelTrade);

  async function run(fn: () => Promise<any>) {
    setError(null);
    try {
      await fn();
    } catch (e: any) {
      setError(e.message ?? "Something went wrong");
    }
  }

  const me = data ? data.players.find((p: any) => p._id === data.myPlayerId) : null;
  const current = data ? data.players[data.game.turn] : null;
  const myTurn = data && me && current && me._id === current._id;
  const phase = data?.game.phase ?? "lobby";

  const myAction = useMemo(() => {
    if (!data) return null;
    const p = data.game.phaseData ?? {};
    // Auctions are open to EVERY alive player, not just the turn player.
    // The turn player who declined gets the last bid; everyone else bids in
    // seat order. Gating this on myTurn is what deadlocked the game.
    if (phase === "auction") {
      const auction = data.auction;
      if (!auction) return null;
      const myIdx = auction.order.findIndex((id: string) => id === data.myPlayerId);
      const isMyBid = myIdx === auction.nextIndex;
      return { kind: "auction" as const, isMyBid, auction };
    }
    if (!myTurn) return null;
    switch (phase) {
      case "roll":
        return { kind: "roll" as const };
      case "jail":
        return { kind: "jail" as const };
      case "buy":
        return { kind: "buy" as const, space: p.space as number };
      case "casino":
        return { kind: "casino" as const };
      case "debt":
        return { kind: "debt" as const, amount: p.amount as number, reason: p.reason as string };
      case "manage":
        return { kind: "manage" as const };
      default:
        return null;
    }
  }, [data, myTurn, phase]);

  if (!data) {
    return <div className="auth-wrap"><div className="auth-card">Loading game…</div></div>;
  }

  const inLobby = data.game.status === "lobby";

  return (
    <div className="game-wrap">
      <div className="game-header">
        <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
          <span className="game-title">{data.game.name}</span>
          <span className="game-code">Code: {data.game.code}</span>
        </div>
        <button className="btn-ghost" style={{ color: "#fff", borderColor: "#888" }} onClick={() => navigate("/")}>
          ← All games
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {inLobby ? (
        <div className="card" style={{ width: "100%", maxWidth: 560 }}>
          <div className="section-title">Lobby — waiting for players</div>
          <div style={{ marginBottom: 12 }}>
            Share this code with friends: <span className="code-pill">{data.game.code}</span>
          </div>
          {data.players.map((p: any) => (
            <div key={p._id} className="player-item" style={{ marginBottom: 8 }}>
              <span className="player-emoji">{p.token.split(" ")[0]}</span>
              <span className="player-name">{p.name}</span>
              <span className="muted tiny">{p.token.split(" ")[1]}</span>
            </div>
          ))}
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button className="btn-primary" disabled={data.players.length < 2} onClick={() => run(() => startGame({ gameId: data.game._id }))}>
              Start game ({data.players.length} player{data.players.length === 1 ? "" : "s"})
            </button>
            <button className="btn-ghost" onClick={() => run(() => leaveGame({ gameId: data.game._id }).then(() => navigate("/")))}>
              Leave lobby
            </button>
          </div>
          {data.players.length < 2 && <div className="muted tiny" style={{ marginTop: 8 }}>Need at least 2 players to start.</div>}
        </div>
      ) : (
        <>
          <Board
            players={data.players}
            lastRoll={data.game.lastRoll ?? null}
            onSpaceClick={(i) => setSelected(i === selected ? null : i)}
            selectedSpace={selected}
            highlighted={myAction?.kind === "buy" ? (myAction as any).space : null}
          />

          <ActionBar
            phase={phase}
            myAction={myAction}
            myTurn={myTurn}
            me={me}
            current={current}
            players={data.players}
            game={data.game}
            auction={data.auction}
            onRoll={() => run(() => roll({ gameId: data.game._id }))}
            onJail={(action: string) => run(() => jailAction({ gameId: data.game._id, action: action as any }))}
            onBuy={() => run(() => buyProperty({ gameId: data.game._id }))}
            onDecline={() => run(() => declineBuy({ gameId: data.game._id }))}
            onEndTurn={() => run(() => endTurn({ gameId: data.game._id }))}
            onSettle={() => run(() => settleDebt({ gameId: data.game._id }))}
            onBankrupt={() => run(() => declareBankruptcy({ gameId: data.game._id }))}
            onBid={(amount: number) => run(() => auctionBid({ gameId: data.game._id, amount }))}
            onPass={() => run(() => auctionPass({ gameId: data.game._id }))}
            onCasino={(action: string) => run(() => casinoAction({ gameId: data.game._id, action: action as any }))}
            onOpenTrade={() => setTradeOpen(true)}
          />

          <div className="panels">
            <PlayerPanel players={data.players} currentId={current?._id} meId={data.myPlayerId} />
            <EventLog events={data.events} />
            <div>
              {data.pendingTrades.map((t) => (
                <PendingTrade
                  key={t._id}
                  trade={t}
                  players={data.players}
                  meId={data.myPlayerId}
                  onRespond={(accept: boolean) => run(() => respondTrade({ tradeId: t._id, accept }))}
                  onCancel={() => run(() => cancelTrade({ tradeId: t._id }))}
                />
              ))}
              <button className="btn-primary" style={{ width: "100%", marginTop: data.pendingTrades.length ? 8 : 0 }} disabled={!me || me.bankrupt} onClick={() => setTradeOpen(true)}>
                💱 Trade
              </button>
            </div>
          </div>
        </>
      )}

      {selected !== null && data && (
        <PropertyModal
          space={selected}
          players={data.players}
          me={me}
          myTurn={myTurn}
          phase={phase}
          houseSupply={data.houseSupply}
          hotelSupply={data.hotelSupply}
          onClose={() => setSelected(null)}
          onBuild={() => run(() => buildHouse({ gameId: data.game._id, space: selected }))}
          onSellHouse={() => run(() => sellHouse({ gameId: data.game._id, space: selected }))}
          onMortgage={() => run(() => mortgage({ gameId: data.game._id, space: selected }))}
          onUnmortgage={() => run(() => unmortgage({ gameId: data.game._id, space: selected }))}
        />
      )}

      {tradeOpen && data && (
        <TradeModal
          players={data.players}
          meId={data.myPlayerId}
          gameId={data.game._id}
          onClose={() => setTradeOpen(false)}
          onError={(msg: string) => setError(msg)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ActionBar(props: any) {
  const { myAction, myTurn, me, current, players, game } = props;
  if (game.status === "finished") {
    const winner = players.find((p: any) => p._id === game.winner);
    return (
      <div className="action-bar">
        <div className="action-status">🏆 {winner ? `${winner.name} wins!` : "Game over"}</div>
        <div className="action-buttons">
          <button className="btn-primary" onClick={() => (window.location.href = "/")}>Back to games</button>
        </div>
      </div>
    );
  }

  const isAuction = myAction?.kind === "auction";
  if (!myAction || (!myTurn && !isAuction)) {
    return (
      <div className="action-bar">
        <div className="action-status">⏳ Waiting on {current?.name}</div>
        <div className="waiting-note">This is async — check back when it's your turn.</div>
      </div>
    );
  }

  switch (myAction.kind) {
    case "roll":
      return (
        <div className="action-bar">
          <div className="action-status">🎲 Your turn — roll the dice!</div>
          <div className="action-buttons">
            <button className="btn-gold" onClick={props.onRoll}>Roll</button>
          </div>
        </div>
      );
    case "jail":
      return (
        <div className="action-bar">
          <div className="action-status">🔒 You're in Jail — 3 ways out</div>
          <div className="action-buttons">
            <button className="btn-gold" onClick={() => props.onJail("roll")}>🎲 Roll for doubles</button>
            <button className="btn-primary" onClick={() => props.onJail("pay")}>💵 Pay $50</button>
            <button className="btn-ghost" disabled={me.getOutOfJailCards < 1} onClick={() => props.onJail("card")}>
              🃏 Use card ({me.getOutOfJailCards})
            </button>
          </div>
        </div>
      );
    case "buy": {
      const space = getSpace(myAction.space);
      return (
        <div className="action-bar">
          <div className="action-status">🏠 Landed on {space.name} — buy for {fmtMoney(space.price ?? 0)}?</div>
          <div className="action-buttons">
            <button className="btn-gold" onClick={props.onBuy}>Buy</button>
            <button className="btn-ghost" onClick={props.onDecline}>Decline (auction)</button>
          </div>
        </div>
      );
    }
    case "auction": {
      const a = myAction.auction;
      return (
        <AuctionBar
          auction={a}
          players={players}
          isMyBid={myAction.isMyBid}
          currentBid={a.currentBid}
          onBid={props.onBid}
          onPass={props.onPass}
        />
      );
    }
    case "casino": {
      const broke = (me?.money ?? 0) < 50;
      return (
        <div className="action-bar">
          <div className="action-status">🎰 Welcome to the Casino — $50 a spin, bank pays the odds</div>
          <div className="action-buttons">
            <button className="btn-gold" disabled={broke} onClick={() => props.onCasino("slots")}>🎰 Slots ($50)</button>
            <button className="btn-primary" disabled={broke} onClick={() => props.onCasino("over")}>⬆️ Over 7 ($50)</button>
            <button className="btn-primary" disabled={broke} onClick={() => props.onCasino("under")}>⬇️ Under 7 ($50)</button>
            <button className="btn-ghost" onClick={() => props.onCasino("pass")}>Pass</button>
          </div>
          {broke && <div className="muted tiny">You can't afford the $50 minimum — pass or sell something.</div>}
        </div>
      );
    }
    case "debt":
      return (
        <div className="action-bar">
          <div className="action-status">
            💸 You owe {fmtMoney(myAction.amount)} ({myAction.reason}). Sell houses or mortgage properties to raise cash, or go bankrupt.
          </div>
          <div className="action-buttons">
            <button className="btn-gold" onClick={props.onSettle}>I have the cash — settle</button>
            <button className="btn-danger" onClick={props.onBankrupt}>Declare bankruptcy</button>
          </div>
        </div>
      );
    case "manage":
      return (
        <div className="action-bar">
          <div className="action-status">✅ Your turn — click properties to build/mortgage, or trade.</div>
          <div className="action-buttons">
            <button className="btn-gold" onClick={props.onEndTurn}>End turn</button>
          </div>
        </div>
      );
    default:
      return null;
  }
}

function AuctionBar({ auction, players, isMyBid, currentBid, onBid, onPass }: any) {
  const [amount, setAmount] = useState(Math.max(currentBid + 1, 10));
  const bidder = players.find((p: any) => p._id === auction.currentBidder);
  return (
    <div className="action-bar">
      <div className="action-status">
        🔨 Auction for {getSpace(auction.spaceIndex).name} — current bid: {fmtMoney(currentBid)}
        {bidder ? ` by ${bidder.name}` : ""}
      </div>
      {isMyBid ? (
        <div className="action-buttons">
          <input type="number" min={currentBid + 1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} style={{ width: 100 }} />
          <button className="btn-gold" onClick={() => onBid(amount)}>Bid</button>
          <button className="btn-ghost" onClick={onPass}>Pass</button>
        </div>
      ) : (
        <div className="waiting-note">Waiting for the next bidder…</div>
      )}
    </div>
  );
}

function PlayerPanel({ players, currentId, meId }: any) {
  return (
    <div className="panel">
      <div className="panel-title">Players</div>
      {players.map((p: any) => (
        <div
          key={p._id}
          className={`player-item ${p._id === meId ? "mine" : ""} ${p._id === currentId ? "current" : ""} ${p.bankrupt ? "bankrupt" : ""}`}
        >
          <span className="player-emoji">{p.token.split(" ")[0]}</span>
          <span className="player-name">{p.name}</span>
          {p.inJail && !p.bankrupt && <span className="player-badge">Jail</span>}
          {p.bankrupt && <span className="player-badge">Out</span>}
          <span className="player-cash">{fmtMoney(p.money)}</span>
        </div>
      ))}
    </div>
  );
}

function EventLog({ events }: any) {
  return (
    <div className="panel">
      <div className="panel-title">Game log</div>
      <div className="event-list">
        {events.length === 0 && <div className="muted">No events yet.</div>}
        {events.map((e: any, i: number) => (
          <div key={i} className="event-item">
            {e.message}
            <div className="when">{new Date(e.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PendingTrade({ trade, players, meId, onRespond, onCancel }: any) {
  const from = players.find((p: any) => p._id === trade.fromPlayerId);
  const to = players.find((p: any) => p._id === trade.toPlayerId);
  const isMine = trade.fromPlayerId === meId;
  const summary = (p: any, cash: number, props: number[]) =>
    `${p?.name}: ${fmtMoney(cash)}${props.length ? ` + ${props.map((s) => getSpace(s).name).join(", ")}` : ""}`;
  return (
    <div className="pending-trade">
      <div className="tiny muted">TRADE OFFER</div>
      <div>{summary(from, trade.fromCash, trade.fromProperties)}</div>
      <div>⇄</div>
      <div>{summary(to, trade.toCash, trade.toProperties)}</div>
      {isMine ? (
        <button className="btn-ghost tiny" style={{ marginTop: 6 }} onClick={onCancel}>Cancel offer</button>
      ) : (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <button className="btn-primary" onClick={() => onRespond(true)}>Accept</button>
          <button className="btn-ghost" onClick={() => onRespond(false)}>Decline</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function PropertyModal({ space, players, me, myTurn, phase, houseSupply, hotelSupply, onClose, onBuild, onSellHouse, onMortgage, onUnmortgage }: any) {
  const s = getSpace(space);
  const owner = players.find((p: any) => p.properties.includes(space));
  const mine = owner && me && owner._id === me._id;
  const myHouseCount = mine ? (me.houses.find((h: any) => h.space === space)?.count ?? 0) : 0;
  const mortgaged = owner?.mortgaged?.includes(space);
  const canManage = myTurn && (phase === "manage" || phase === "debt");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        {s.group && (
          <div className="prop-strip" style={{ background: GROUP_COLORS[s.group] }} />
        )}
        <div className="modal-title">{s.name}</div>
        {owner ? (
          <div className="owner-line">Owned by <b>{owner.name}</b>{mortgaged ? " (mortgaged)" : ""}</div>
        ) : (
          <div className="owner-line">Unowned — Bank</div>
        )}

        {s.type === "property" && (
          <div className="rent-grid">
            <span>Rent</span><span className="amt">{fmtMoney(s.rents![0])}</span>
            <span>With color group (no houses)</span><span className="amt">{fmtMoney(s.rents![0] * 2)}</span>
            <span>1 house</span><span className="amt">{fmtMoney(s.rents![1])}</span>
            <span>2 houses</span><span className="amt">{fmtMoney(s.rents![2])}</span>
            <span>3 houses</span><span className="amt">{fmtMoney(s.rents![3])}</span>
            <span>4 houses</span><span className="amt">{fmtMoney(s.rents![4])}</span>
            <span>HOTEL</span><span className="amt">{fmtMoney(s.rents![5])}</span>
          </div>
        )}
        {s.type === "railroad" && (
          <div className="rent-grid">
            <span>1 railroad</span><span className="amt">$25</span>
            <span>2 railroads</span><span className="amt">$50</span>
            <span>3 railroads</span><span className="amt">$100</span>
            <span>4 railroads</span><span className="amt">$200</span>
          </div>
        )}
        {s.type === "utility" && (
          <div className="rent-grid">
            <span>1 utility owned</span><span className="amt">4× dice</span>
            <span>2 utilities owned</span><span className="amt">10× dice</span>
          </div>
        )}

        <div className="stat-line"><span>Price</span><span>{fmtMoney(s.price ?? 0)}</span></div>
        {s.houseCost !== undefined && <div className="stat-line"><span>House cost</span><span>{fmtMoney(s.houseCost)}</span></div>}
        {s.mortgage !== undefined && <div className="stat-line"><span>Mortgage value</span><span>{fmtMoney(s.mortgage)}</span></div>}

        {mine && canManage && s.type === "property" && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="muted tiny">
              You have {myHouseCount === 5 ? "a hotel" : `${myHouseCount} house${myHouseCount === 1 ? "" : "s"}`} here.
              Bank: {houseSupply} houses / {hotelSupply} hotels left.
            </div>
            {myHouseCount < 5 && !mortgaged && (
              <button className="btn-primary" onClick={onBuild}>Build {myHouseCount === 4 ? "hotel" : "house"} ({fmtMoney(s.houseCost ?? 0)})</button>
            )}
            {myHouseCount > 0 && <button className="btn-ghost" onClick={onSellHouse}>Sell house (get {fmtMoney(Math.floor((s.houseCost ?? 0) / 2))})</button>}
            {!mortgaged && myHouseCount === 0 && (
              <button className="btn-ghost" onClick={onMortgage}>Mortgage (get {fmtMoney(s.mortgage ?? 0)})</button>
            )}
            {mortgaged && <button className="btn-primary" onClick={onUnmortgage}>Unmortgage ({fmtMoney(Math.ceil((s.mortgage ?? 0) * 1.1))})</button>}
          </div>
        )}
        {mine && !canManage && (
          <div className="muted tiny" style={{ marginTop: 10 }}>You can manage this on your turn (or while settling debt).</div>
        )}
      </div>
    </div>
  );
}

function TradeModal({ players, meId, gameId, onClose, onError }: any) {
  const sendTrade = useMutation(api.game.sendTrade);
  const me = players.find((p: any) => p._id === meId);
  const others = players.filter((p: any) => p._id !== meId && !p.bankrupt);
  const [toId, setToId] = useState<string | null>(others[0]?._id ?? null);
  const [myProps, setMyProps] = useState<number[]>([]);
  const [theirProps, setTheirProps] = useState<number[]>([]);
  const [myCash, setMyCash] = useState(0);
  const [theirCash, setTheirCash] = useState(0);
  const [busy, setBusy] = useState(false);

  const target = others.find((p: any) => p._id === toId);

  function toggle(list: number[], set: (v: number[]) => void, v: number) {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  }

  async function send() {
    if (!toId) return;
    setBusy(true);
    try {
      await sendTrade({
        gameId,
        toPlayerId: toId as any,
        fromCash: myCash,
        fromProperties: myProps,
        toCash: theirCash,
        toProperties: theirProps,
      });
      onClose();
    } catch (e: any) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="modal-title">💱 Trade</div>
        <label>Trade with</label>
        <select value={toId ?? ""} onChange={(e) => { setToId(e.target.value); setTheirProps([]); }} style={{ width: "100%", margin: "6px 0 12px", padding: 8, borderRadius: 8, border: "1.5px solid var(--border)" }}>
          {others.map((p: any) => <option key={p._id} value={p._id}>{p.name}</option>)}
        </select>

        <div className="trade-side">
          <h4>You give ({me?.name})</h4>
          {me?.properties.filter((s: number) => !me.mortgaged.includes(s) && !(me.houses.find((h: any) => h.space === s)?.count)).map((s: number) => (
            <label key={s} className="check-row">
              <input type="checkbox" checked={myProps.includes(s)} onChange={() => toggle(myProps, setMyProps, s)} />
              {getSpace(s).name}
            </label>
          ))}
          <div className="trade-cash">Cash <input type="number" min={0} max={me?.money ?? 0} value={myCash} onChange={(e) => setMyCash(Math.max(0, Number(e.target.value)))} /> (you have {fmtMoney(me?.money ?? 0)})</div>
        </div>

        <div className="trade-side">
          <h4>You receive ({target?.name})</h4>
          {target?.properties.filter((s: number) => !target.mortgaged.includes(s) && !(target.houses.find((h: any) => h.space === s)?.count)).map((s: number) => (
            <label key={s} className="check-row">
              <input type="checkbox" checked={theirProps.includes(s)} onChange={() => toggle(theirProps, setTheirProps, s)} />
              {getSpace(s).name}
            </label>
          ))}
          <div className="trade-cash">Cash <input type="number" min={0} max={target?.money ?? 0} value={theirCash} onChange={(e) => setTheirCash(Math.max(0, Number(e.target.value)))} /> (they have {fmtMoney(target?.money ?? 0)})</div>
        </div>

        <button className="btn-primary" style={{ width: "100%" }} disabled={busy || !toId} onClick={send}>
          {busy ? "Sending…" : "Send offer"}
        </button>
      </div>
    </div>
  );
}
