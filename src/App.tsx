import { Routes, Route, Navigate } from "react-router-dom";
import { useConvexAuth } from "@convex-dev/auth/react";
import { AuthScreen } from "./components/AuthScreen";
import { Home } from "./components/Home";
import { Game } from "./components/Game";

function Gate({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading) {
    return (
      <div className="auth-wrap">
        <div className="auth-card" style={{ textAlign: "center" }}>
          <div className="auth-logo">🦀</div>
          <div className="auth-sub">Loading…</div>
        </div>
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<AuthScreen />} />
      <Route
        path="/"
        element={
          <Gate>
            <Home />
          </Gate>
        }
      />
      <Route
        path="/game/:gameId"
        element={
          <Gate>
            <Game />
          </Gate>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
