import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";

export function Home() {
  const navigate = useNavigate();
  const { signOut } = useAuthActions();
  const games = (useQuery(api.game.getMyGames) ?? []).filter((g): g is NonNullable<typeof g> => g !== null);
  const createGame = useMutation(api.game.createGame);
  const joinGame = useMutation(api.game.joinGame);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCreate() {
    setBusy(true);
    setError(null);
    try {
      const id = await createGame({});
      navigate(`/game/${id}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function onJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const id = await joinGame({ code: code.trim() });
      navigate(`/game/${id}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const statusLabel: Record<string, string> = {
    lobby: "Waiting for players",
    playing: "In progress",
    finished: "Finished",
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="brand">
          🦀 Crab<span>opoly</span>
        </div>
        <button
          className="btn-ghost"
          style={{ color: "#fff", borderColor: "#fff" }}
          onClick={() => signOut()}
        >
          Sign out
        </button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-title">Start a game</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn-primary" onClick={onCreate} disabled={busy}>
            + New game
          </button>
          <form onSubmit={onJoin} className="join-row" style={{ flex: 1 }}>
            <input
              className="grow-input"
              placeholder="Join with 6-letter code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={6}
            />
            <button className="btn-gold" disabled={busy || !code.trim()}>
              Join
            </button>
          </form>
        </div>
        {error && <div className="auth-error" style={{ marginTop: 10 }}>{error}</div>}
      </div>

      <div className="card">
        <div className="section-title">Your games</div>
        {games.length === 0 ? (
          <div className="muted">No games yet. Create one and send the code to your friends.</div>
        ) : (
          games.map((g) => (
            <div key={g._id} className="game-row" onClick={() => navigate(`/game/${g._id}`)}>
              <div>
                <div className="game-row-name">{g.name}</div>
                <div className="game-row-meta">
                  {statusLabel[g.status] ?? g.status}
                </div>
              </div>
              <span className="code-pill">{g.code}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
