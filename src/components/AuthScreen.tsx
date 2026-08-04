import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useNavigate } from "react-router-dom";

export function AuthScreen() {
  const { signIn } = useAuthActions();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signIn" | "signUp">("signUp");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email || !password) {
      setError("Email and password are required.");
      return;
    }
    if (mode === "signUp" && password.length < 4) {
      setError("Password must be at least 4 characters.");
      return;
    }
    setBusy(true);
    try {
      await signIn("password", {
        email,
        password,
        name: name || email.split("@")[0],
        flow: mode,
      });
      navigate("/");
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo">🦀</div>
        <div className="auth-title">Crabopoly</div>
        <div className="auth-sub">
          Async Monopoly with the boys. Log in once, stay logged in.
        </div>
        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${mode === "signUp" ? "active" : ""}`}
            onClick={() => setMode("signUp")}
          >
            Sign up
          </button>
          <button
            type="button"
            className={`auth-tab ${mode === "signIn" ? "active" : ""}`}
            onClick={() => setMode("signIn")}
          >
            Log in
          </button>
        </div>
        {error && <div className="auth-error">{error}</div>}
        {mode === "signUp" && (
          <div className="auth-field">
            <label>Display name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Shlok"
            />
          </div>
        )}
        <div className="auth-field">
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </div>
        <div className="auth-field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete={mode === "signUp" ? "new-password" : "current-password"}
          />
        </div>
        <button className="btn-primary" style={{ width: "100%" }} disabled={busy}>
          {busy ? "Working…" : mode === "signUp" ? "Create account" : "Log in"}
        </button>
      </form>
    </div>
  );
}
