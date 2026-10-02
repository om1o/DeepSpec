import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import Button from "../components/ui/Button";
import { redirectBrowser } from "../lib/browserRedirect";
import { getAuthClient, getVerifiedAuthUser } from "../services/auth";

type ConsentDetails = {
  authorization_id: string;
  client: { name?: string };
  scope: string;
  user: { email: string };
};

export default function OAuthConsent() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const authorizationId = searchParams.get("authorization_id")?.trim() ?? "";
  const [details, setDetails] = useState<ConsentDetails | null>(null);
  const [status, setStatus] = useState("Checking this connection...");
  const [deciding, setDeciding] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!authorizationId) {
        setStatus("This authorization request is missing its ID.");
        return;
      }
      const user = await getVerifiedAuthUser().catch(() => null);
      if (!active) return;
      if (!user) {
        navigate("/auth", { replace: true, state: { from: `${location.pathname}${location.search}` } });
        return;
      }
      const client = await getAuthClient();
      if (!client) {
        setStatus("DeepSpec authentication is not configured in this build.");
        return;
      }
      const response = await client.auth.oauth.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (response.error || !response.data) {
        setStatus(response.error?.message ?? "This authorization request could not be loaded.");
        return;
      }
      if ("redirect_url" in response.data) {
        redirectBrowser(response.data.redirect_url);
        return;
      }
      setDetails(response.data);
      setStatus("");
    }
    void load();
    return () => { active = false; };
  }, [authorizationId, location.pathname, location.search, navigate]);

  async function decide(approved: boolean) {
    if (!details || deciding) return;
    setDeciding(true);
    setStatus(approved ? "Connecting..." : "Declining...");
    try {
      const client = await getAuthClient();
      if (!client) throw new Error("DeepSpec authentication is not configured in this build.");
      const response = approved
        ? await client.auth.oauth.approveAuthorization(details.authorization_id, { skipBrowserRedirect: true })
        : await client.auth.oauth.denyAuthorization(details.authorization_id, { skipBrowserRedirect: true });
      if (response.error || !response.data?.redirect_url) {
        throw new Error(response.error?.message ?? "The authorization decision could not be completed.");
      }
      redirectBrowser(response.data.redirect_url);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The authorization decision could not be completed.");
      setDeciding(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--ds-page)] px-5 py-10 text-white">
      <section className="w-full max-w-lg rounded-[8px] border border-white/15 bg-[#091321] p-6 shadow-2xl sm:p-8">
        <img src="/brand/deepspec-logo.webp" alt="DeepSpec" className="h-12 w-40 rounded-[8px] bg-white object-contain p-1" />
        <p className="mt-7 text-xs font-black text-[#a8d2dc]">ACCOUNT CONNECTION</p>
        <h1 className="mt-3 text-3xl font-black leading-tight">Connect {details?.client.name || "ChatGPT"} to DeepSpec</h1>

        {details ? (
          <>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              Signed in as <strong className="text-white">{details.user.email}</strong>. The connection can analyze vehicle images and save a scan only when you explicitly request it.
            </p>
            <div className="mt-6 border-y border-white/15 py-5 text-sm leading-6 text-slate-300">
              <p><strong className="text-white">It can:</strong> read the image you choose, return a DeepSpec analysis with sources, and save confirmed scans to your private history.</p>
              <p className="mt-3"><strong className="text-white">It cannot:</strong> silently save every chat image, access another account, or turn a saved scan into training permission.</p>
              <p className="mt-3 text-xs text-slate-400">Requested scopes: {details.scope || "basic account access"}</p>
            </div>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
              <Button className="sm:flex-1" disabled={deciding} onClick={() => void decide(true)}>Connect DeepSpec</Button>
              <button className="h-12 rounded-[8px] border border-white/20 px-5 text-sm font-bold text-white disabled:opacity-60 sm:flex-1" disabled={deciding} onClick={() => void decide(false)} type="button">
                Deny
              </button>
            </div>
          </>
        ) : null}

        {status ? <p role="status" className="mt-5 text-sm font-bold text-[#a8d2dc]">{status}</p> : null}
        <p className="mt-6 text-xs leading-5 text-slate-400">DeepSpec is an identification and documentation aid. A photo does not prove exact fitment, hidden condition, or repair safety.</p>
      </section>
    </main>
  );
}
