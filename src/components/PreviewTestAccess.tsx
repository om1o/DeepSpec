import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getAuthClient, signInToPreviewTestAccount, signOut } from "../services/auth";

// The legacy marker is not a credential. The localhost launcher already sets a
// Secure HttpOnly cookie. Phone invitations carry a short-lived capability in a
// URL fragment (not transmitted in page requests); immediately scrub it from
// the address bar and submit it only to the same-origin cookie launcher.
let pendingCapability: string | null = null;
let privateTestControls = takePrivateTestMarker();

function takePrivateTestMarker(): boolean {
  const url = new URL(window.location.href);
  const privateLink = /^#private-qa=([a-f0-9]{64})$/.exec(url.hash);
  const hasLegacyMarker = url.searchParams.get("private-test") === "1";
  const hadPrivateFragment = url.hash.startsWith("#private-qa=");
  if (hadPrivateFragment) {
    url.hash = "";
    if (privateLink) pendingCapability = privateLink[1];
  }
  if (hasLegacyMarker) url.searchParams.delete("private-test");
  if (hadPrivateFragment || hasLegacyMarker) {
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }
  return Boolean(privateLink || hasLegacyMarker);
}

export function PreviewTestAccess({ placement = "banner" }: { placement?: "banner" | "auth" }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [finished, setFinished] = useState(false);
  const [serverCleanupConfirmed, setServerCleanupConfirmed] = useState(false);
  if (!privateTestControls || finished) return null;

  async function startTest() {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      if (pendingCapability) {
        const launch = await fetch("/api/qa-test-launch", {
          method: "POST", cache: "no-store", credentials: "same-origin",
          headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
          body: new URLSearchParams({ capability: pendingCapability }).toString(),
        });
        if (launch.status !== 204) throw new Error();
        pendingCapability = null;
      }
      const response = await fetch("/api/qa-test-session", {
        method: "POST", cache: "no-store", credentials: "same-origin",
      });
      if (!response.ok) throw new Error();
      const result: unknown = await response.json();
      if (!result || typeof result !== "object" || !("token_hash" in result) || !("userId" in result)
        || typeof result.token_hash !== "string" || typeof result.userId !== "string") throw new Error();
      const user = await signInToPreviewTestAccount(result.token_hash, result.userId);
      setNotice(`Test account: ${user.id}. Normal scan limits apply.`);
      navigate("/scan", { replace: true });
    } catch {
      setNotice("Test entry failed or expired. The normal sign-in controls remain available.");
    } finally { setBusy(false); }
  }

  async function finishTest() {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      if (!serverCleanupConfirmed) {
        const client = await getAuthClient();
        const session = await client?.auth.getSession();
        if (!session?.data.session || session.error) throw new Error();
        const response = await fetch("/api/qa-test-session", {
          method: "DELETE", cache: "no-store", credentials: "same-origin",
          headers: { "x-qa-session": session.data.session.access_token },
        });
        if (!response.ok) throw new Error();
        const result: unknown = await response.json();
        if (!result || typeof result !== "object" || !("cleaned" in result) || result.cleaned !== true) throw new Error();
        setServerCleanupConfirmed(true);
      }
      await signOut();
      privateTestControls = false;
      pendingCapability = null;
      setFinished(true);
      navigate("/auth", { replace: true });
    } catch {
      setNotice("Cleanup or local sign-out needs a retry. Keep this page open; a confirmed account removal will not be repeated.");
    } finally { setBusy(false); }
  }

  if (placement === "auth") {
    if (location.pathname !== "/auth" || serverCleanupConfirmed) return null;
    return (
      <div role="group" aria-label="Private test entry" className="rounded-[8px] border border-sky-200/25 bg-sky-400/10 p-3 text-center">
        <button type="button" disabled={busy} onClick={() => void startTest()} className="h-12 w-full rounded-[8px] border border-white/30 bg-white/10 px-4 text-sm font-semibold text-white hover:bg-white/15 disabled:opacity-50">
          {busy ? "Opening AI…" : "Skip sign-in and try AI"}
        </button>
        <p className="mt-2 text-xs leading-5 text-white/70">Private preview only. Opens a temporary test account with normal scan limits.</p>
        {notice ? <p role="status" className="mt-2 text-sm text-white">{notice}</p> : null}
      </div>
    );
  }

  if (location.pathname === "/auth") return null;
  return (
    <aside aria-label="Temporary private test access" className="relative z-50 border-b border-amber-400 bg-slate-950 p-3 text-sm text-white">
      <p>Temporary private test access</p>
      <button type="button" disabled={busy} onClick={() => void finishTest()} className="mt-2 rounded border border-white px-4 py-2">
        {serverCleanupConfirmed ? "Retry local sign-out" : "Finish test and remove test account"}
      </button>
      {notice ? <p role="status" className="mt-2">{notice}</p> : null}
    </aside>
  );
}
