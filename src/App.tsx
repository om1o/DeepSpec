import type { ReactNode } from "react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import Auth from "./screens/Auth";
import Chat from "./screens/Chat";
import EarlyAccess from "./screens/EarlyAccess";
import History from "./screens/History";
import Account from "./screens/Account";
import Pricing from "./screens/Pricing";
import Result from "./screens/Result";
import Shop from "./screens/Shop";
import ShopJob from "./screens/ShopJob";
import ShopNewJob from "./screens/ShopNewJob";
import { getVerifiedAuthUser, subscribeToAuthChanges } from "./services/auth";
import { startOfflineUpgradeWatcher } from "./services/offlineUpgrade";

const loadScanner = () => import("./screens/Scanner");
const Scanner = lazy(loadScanner);
// Warm the Scanner chunk alongside app boot so navigating to /scan doesn't
// stall on the chunk download behind the "Opening camera..." fallback.
void loadScanner().catch(() => {});

type AuthStatus = "checking" | "allowed" | "blocked";

function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [status, setStatus] = useState<AuthStatus>("checking");

  useEffect(() => {
    let isMounted = true;
    let unsubscribe: () => void = () => undefined;

    getVerifiedAuthUser()
      .then((user) => {
        if (isMounted) {
          setStatus(user ? "allowed" : "blocked");
        }
      })
      .catch(() => {
        if (isMounted) {
          setStatus("blocked");
        }
      });

    subscribeToAuthChanges((user) => {
      if (isMounted) {
        setStatus(user ? "allowed" : "blocked");
      }
    }).then((cleanup) => {
      if (isMounted) {
        unsubscribe = cleanup;
      } else {
        cleanup();
      }
    }).catch(() => {
      if (isMounted) {
        setStatus((current) => (
          current === "checking" ? "blocked" : current
        ));
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  if (status === "checking") {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[var(--ds-bg)] px-4 text-center text-sm font-bold text-[var(--ds-fg-3)]">
        Checking your session...
      </main>
    );
  }

  if (status === "blocked") {
    return <Navigate to="/auth" replace state={{ from: `${location.pathname}${location.search}${location.hash}` }} />;
  }

  return <>{children}</>;
}

function ScannerRouteFallback() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--ds-bg)] px-4 text-center text-sm font-bold text-[var(--ds-fg-3)]">
      Opening camera...
    </main>
  );
}

export default function App() {
  useEffect(() => startOfflineUpgradeWatcher(), []);

  return (
    <Routes>
      <Route path="/auth" element={<Auth />} />
      <Route path="/" element={<Navigate to="/scan" replace />} />
      <Route
        path="/scan"
        element={
          <RequireAuth>
            <Suspense fallback={<ScannerRouteFallback />}>
              <Scanner />
            </Suspense>
          </RequireAuth>
        }
      />
      <Route
        path="/history"
        element={
          <RequireAuth>
            <History />
          </RequireAuth>
        }
      />
      <Route
        path="/early-access"
        element={
          <RequireAuth>
            <EarlyAccess />
          </RequireAuth>
        }
      />
      <Route
        path="/pricing"
        element={
          <RequireAuth>
            <Pricing />
          </RequireAuth>
        }
      />
      <Route
        path="/shop"
        element={
          <RequireAuth>
            <Shop />
          </RequireAuth>
        }
      />
      <Route
        path="/shop/new"
        element={
          <RequireAuth>
            <ShopNewJob />
          </RequireAuth>
        }
      />
      <Route
        path="/shop/jobs/:jobId"
        element={
          <RequireAuth>
            <ShopJob />
          </RequireAuth>
        }
      />
      <Route
        path="/account"
        element={
          <RequireAuth>
            <Account />
          </RequireAuth>
        }
      />
      <Route
        path="/result"
        element={
          <RequireAuth>
            <Result />
          </RequireAuth>
        }
      />
      <Route
        path="/result/:id"
        element={
          <RequireAuth>
            <Result />
          </RequireAuth>
        }
      />
      <Route
        path="/result/:id/chat"
        element={
          <RequireAuth>
            <Chat />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
