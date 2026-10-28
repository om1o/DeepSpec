import type { ReactNode } from "react";
import { Fragment, lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import Auth from "./screens/Auth";
import { isGuestPreview } from "./lib/guestPreview";
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
import { getAccountScope, setActiveAccount, setActiveGuestPreview } from "./lib/accountScope";

const loadScanner = () => import("./screens/Scanner");
const Scanner = lazy(loadScanner);
// Warm the camera for account routes; the public demo needs no camera or ML.
if (window.location.pathname !== "/" && !window.location.pathname.startsWith("/intro")) {
  void loadScanner().catch(() => {});
}

type AuthStatus = "checking" | "allowed" | "blocked";

function GuestAccess({ children }: { children: ReactNode }) {
  const [ready] = useState(setActiveGuestPreview);
  return ready ? <>{children}</> : <Navigate to="/auth" replace />;
}

function AppAccess({ children }: { children: ReactNode }) {
  return isGuestPreview() ? <GuestAccess>{children}</GuestAccess> : <RequireAuth>{children}</RequireAuth>;
}

function IntroEntry() {
  useEffect(() => { window.location.replace("/intro/index.html"); }, []);
  return <main className="flex min-h-dvh items-center justify-center bg-[var(--ds-bg)] text-[var(--ds-fg-3)]"><a href="/intro/index.html">Open DeepSpec</a></main>;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    let unsubscribe: () => void = () => undefined;
    let revision = 0;
    const applyUser = (user: { id: string } | null) => {
      setActiveAccount(user?.id ?? null);
      setUserId(user?.id ?? null);
      setStatus(user ? "allowed" : "blocked");
    };

    getVerifiedAuthUser()
      .then((user) => {
        if (isMounted && revision === 0) {
          applyUser(user);
        }
      })
      .catch(() => {
        if (isMounted && revision === 0) {
          applyUser(null);
        }
      });

    subscribeToAuthChanges((user) => {
      if (isMounted) {
        revision += 1;
        applyUser(user);
      }
    }, (pendingUserId) => {
      if (!isMounted) return;
      revision += 1;
      setStatus((current) => current === "allowed" && getAccountScope().userId === pendingUserId ? current : "checking");
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

  return <Fragment key={userId}>{children}</Fragment>;
}

function ScannerRouteFallback() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--ds-bg)] px-4 text-center text-sm font-bold text-[var(--ds-fg-3)]">
      Opening camera...
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/auth" element={isGuestPreview() ? <Navigate to="/scan" replace /> : <Auth />} />
      <Route path="/demo" element={<Navigate to="/scan" replace />} />
      <Route path="/intro" element={<IntroEntry />} />
      <Route path="/" element={isGuestPreview() ? <IntroEntry /> : <Navigate to="/scan" replace />} />
      <Route
        path="/scan"
        element={
          <AppAccess>
            <Suspense fallback={<ScannerRouteFallback />}>
              <Scanner />
            </Suspense>
          </AppAccess>
        }
      />
      <Route
        path="/history"
        element={
          <AppAccess>
            <History />
          </AppAccess>
        }
      />
      <Route
        path="/early-access"
        element={
          <AppAccess>
            <EarlyAccess />
          </AppAccess>
        }
      />
      <Route
        path="/pricing"
        element={
          <AppAccess>
            <Pricing />
          </AppAccess>
        }
      />
      <Route
        path="/shop"
        element={
          <AppAccess>
            <Shop />
          </AppAccess>
        }
      />
      <Route
        path="/shop/new"
        element={
          <AppAccess>
            <ShopNewJob />
          </AppAccess>
        }
      />
      <Route
        path="/shop/jobs/:jobId"
        element={
          <AppAccess>
            <ShopJob />
          </AppAccess>
        }
      />
      <Route
        path="/account"
        element={
          <AppAccess>
            <Account />
          </AppAccess>
        }
      />
      <Route
        path="/result"
        element={
          <AppAccess>
            <Result />
          </AppAccess>
        }
      />
      <Route
        path="/result/:id"
        element={
          <AppAccess>
            <Result />
          </AppAccess>
        }
      />
      <Route
        path="/result/:id/chat"
        element={
          <AppAccess>
            <Chat />
          </AppAccess>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
