import { ClipboardEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  getVerifiedAuthUser,
  hasPendingSignOut,
  isGitHubAuthEnabled,
  isGoogleAuthEnabled,
  normalizePostAuthRedirectPath,
  isSupabaseAuthConfigured,
  sendEmailSignInLink,
  signInAnonymously,
  signInWithGitHub,
  signInWithGoogle,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  subscribeToPendingSignOut,
  verifyEmailCode,
} from "../services/auth";

type AuthStep = "email" | "sent" | "code";
type AuthMode = "link" | "password";
type PasswordMode = "signin" | "signup" | "anonymous";
const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 30;

function formatAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  // Supabase returns a verbose policy dump for weak passwords — replace it.
  if (/Password should contain/i.test(message) || /weak password/i.test(message)) {
    return "Password needs 8+ characters with an uppercase, a lowercase, a number, and a symbol.";
  }
  return message || "Sign-in didn't go through. Try again.";
}

export default function Auth() {
  const location = useLocation();
  const navigate = useNavigate();
  const supabaseConfigured = isSupabaseAuthConfigured();
  const googleAuthEnabled = isGoogleAuthEnabled();
  const githubAuthEnabled = isGitHubAuthEnabled();
  const oauthEnabled = googleAuthEnabled || githubAuthEnabled;
  const canSubmit = supabaseConfigured;
  const [authMode, setAuthMode] = useState<AuthMode>("password");
  const [passwordMode, setPasswordMode] = useState<PasswordMode>("signin");
  const [step, setStep] = useState<AuthStep>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pendingSignOut = useSyncExternalStore(subscribeToPendingSignOut, hasPendingSignOut);
  const visibleNotice = pendingSignOut
    ? "Private screens are locked. Sign-out has not been confirmed. Retry signing out, or sign in again explicitly."
    : notice;
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isGitHubLoading, setIsGitHubLoading] = useState(false);
  const isBusy = isSubmitting || isGoogleLoading || isGitHubLoading;
  const requestPending = useRef(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const codeInputRef = useRef<HTMLInputElement | null>(null);
  const autoSubmittedCodeRef = useRef<string | null>(null);
  const postAuthPath = useMemo(() => {
    const fromState = typeof location.state?.from === "string" ? location.state.from : null;
    const fromQuery = new URLSearchParams(location.search).get("next");
    return normalizePostAuthRedirectPath(fromState ?? fromQuery);
  }, [location.search, location.state]);

  const finishVerifiedLogin = useCallback(async () => {
    // Older device records can be behind cloud edits. Retry them explicitly from
    // Saved scans until server revision checks make automatic replay safe.
    navigate(postAuthPath, { replace: true });
  }, [navigate, postAuthPath]);

  useEffect(() => {
    let isMounted = true;

    getVerifiedAuthUser()
      .then((user) => {
        if (isMounted && user) {
          void finishVerifiedLogin();
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (isMounted) {
          setIsCheckingSession(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [finishVerifiedLogin]);

  useEffect(() => {
    if (step === "code") {
      codeInputRef.current?.focus();
    }
  }, [step]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setResendCooldown((previous) => Math.max(0, previous - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  const verifyCurrentCode = useCallback(async () => {
    if (requestPending.current || !supabaseConfigured) return;
    requestPending.current = true;
    setError(null);
    setNotice(null);
    setIsSubmitting(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      await verifyEmailCode(normalizedEmail, code.trim());
      await finishVerifiedLogin();
    } catch (authError) {
      setError(formatAuthError(authError));
    } finally {
      requestPending.current = false;
      setIsSubmitting(false);
    }
  }, [code, email, finishVerifiedLogin, supabaseConfigured]);

  useEffect(() => {
    if (step !== "code" || !supabaseConfigured || isSubmitting) return;
    if (code.length !== CODE_LENGTH) {
      if (code.length < CODE_LENGTH) autoSubmittedCodeRef.current = null;
      return;
    }
    if (autoSubmittedCodeRef.current === code) return;
    autoSubmittedCodeRef.current = code;
    void verifyCurrentCode();
  }, [code, isSubmitting, step, supabaseConfigured, verifyCurrentCode]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestPending.current) return;
    setError(null);
    setNotice(null);

    if (!supabaseConfigured) {
      setError("Supabase auth is not configured for this build.");
      return;
    }

    if (authMode === "password") {
      requestPending.current = true;
      setIsSubmitting(true);
      try {
        const normalizedEmail = email.trim().toLowerCase();
        const user = passwordMode === "anonymous"
          ? await signInAnonymously()
          : passwordMode === "signup"
            ? await signUpWithPassword(normalizedEmail, password, postAuthPath)
            : await signInWithPassword(normalizedEmail, password);
        if (user) {
          await finishVerifiedLogin();
          return;
        }
        if (passwordMode === "signup") {
          setPassword("");
          setPasswordMode("signin");
          setNotice("Check your inbox for a confirmation link, then sign in. If you already have an account, use your existing password or an email sign-in link.");
        }
      } catch (authError) {
        setError(formatAuthError(authError));
      } finally {
        requestPending.current = false;
        setIsSubmitting(false);
      }
      return;
    }

    if (step === "code") {
      await verifyCurrentCode();
      return;
    }

    requestPending.current = true;
    setIsSubmitting(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const delivery = await sendEmailSignInLink(normalizedEmail, postAuthPath);
      if (delivery.delivery === "code") {
        setStep("code");
        setNotice(`Code sent to ${normalizedEmail}. Enter the 6 digits below.`);
      } else {
        setStep("sent");
        setNotice(`Sign-in link sent to ${normalizedEmail}. Open it to finish.`);
      }
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (authError) {
      setError(formatAuthError(authError));
    } finally {
      requestPending.current = false;
      setIsSubmitting(false);
    }
  }

  async function handleGoogleSignIn() {
    if (requestPending.current) return;
    requestPending.current = true;
    setError(null);
    setNotice(null);
    setIsGoogleLoading(true);

    try {
      await signInWithGoogle(postAuthPath);
    } catch (authError) {
      requestPending.current = false;
      setError(formatAuthError(authError));
      setIsGoogleLoading(false);
    }
  }

  async function retrySignOut() {
    if (requestPending.current) return;
    requestPending.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      await signOut();
      setNotice("Signed out. You can sign in again when ready.");
    } catch {
      setNotice("Private screens remain locked. Sign-out could not be confirmed; check your connection and retry.");
    } finally {
      requestPending.current = false;
      setIsSubmitting(false);
    }
  }

  async function handleGitHubSignIn() {
    if (requestPending.current) return;
    requestPending.current = true;
    setError(null);
    setNotice(null);
    setIsGitHubLoading(true);

    try {
      await signInWithGitHub(postAuthPath);
    } catch (authError) {
      requestPending.current = false;
      setError(formatAuthError(authError));
      setIsGitHubLoading(false);
    }
  }

  async function handleResendLink() {
    if (resendCooldown > 0 || requestPending.current) return;
    requestPending.current = true;
    setError(null);
    setNotice(null);
    setIsSubmitting(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const delivery = await sendEmailSignInLink(normalizedEmail, postAuthPath);
      if (delivery.delivery === "code") {
        setStep("code");
        setNotice(`New code sent to ${normalizedEmail}.`);
      } else {
        setStep("sent");
        setNotice(`New sign-in link sent to ${normalizedEmail}.`);
      }
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      setCode("");
      autoSubmittedCodeRef.current = null;
    } catch (authError) {
      setError(formatAuthError(authError));
    } finally {
      requestPending.current = false;
      setIsSubmitting(false);
    }
  }

  function handleCodePaste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData("text");
    const digits = pasted.replace(/\D/g, "").slice(0, CODE_LENGTH);
    if (!digits) return;
    event.preventDefault();
    setCode(digits);
  }

  function handleUseDifferentEmail() {
    setStep("email");
    setCode("");
    setError(null);
    setNotice(null);
    autoSubmittedCodeRef.current = null;
  }

  function handleShowCodeEntry() {
    setStep("code");
    setCode("");
    setError(null);
    setNotice("Enter the 6 digits from your email.");
    autoSubmittedCodeRef.current = null;
  }

  function switchAuthMode(mode: AuthMode) {
    setAuthMode(mode);
    setStep("email");
    setCode("");
    setError(null);
    setNotice(null);
    setPasswordMode("signin");
    autoSubmittedCodeRef.current = null;
  }

  if (isCheckingSession) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[var(--ds-bg)] px-4 text-center text-sm font-bold text-[var(--ds-fg-3)]">
        <div className="rounded-[8px] border border-white/10 bg-white/10 px-5 py-3 shadow-sm backdrop-blur-md">
          Checking session...
        </div>
      </main>
    );
  }

  return (
    <main className="ds-auth-page min-h-dvh px-4 pb-8 pt-[max(20px,env(safe-area-inset-top))] text-white">
      <section className="mx-auto grid min-h-[calc(100dvh-48px)] w-full max-w-6xl items-center gap-5 lg:grid-cols-[1.08fr_0.92fr] lg:gap-12">
        <div className="ds-auth-story">
          <img src="/brand/alternator-workbench.webp" alt="" width="1086" height="1448" className="ds-auth-art" />
          <div className="ds-auth-story-top">
            <span className="ds-eyebrow">FROM THE BENCH TO THE RECORD</span>
            <h2>A clearer picture.<br /><span>A better part record.</span></h2>
            <p>Capture a part. Review the evidence.<br />Keep the details that matter.</p>
          </div>
          <div className="ds-auth-story-bottom">
            <span className="ds-art-caption">Illustrative render · Not a scan result</span>
            <div className="ds-workflow" aria-label="Parts documentation workflow">
              <StatusCell label="01" value="Capture" />
              <StatusCell label="02" value="Review" />
              <StatusCell label="03" value="Save" />
            </div>
          </div>
        </div>

        <section className="ds-auth-card mx-auto flex w-full max-w-[540px] flex-col p-5 sm:p-8">
          <div className="flex items-center justify-between gap-4">
            <img src="/brand/deepspec-logo.webp" alt="Deep Spec" className="h-14 w-44 rounded-[8px] bg-white object-contain p-1 shadow-sm ring-1 ring-white/20" />
            <span className={supabaseConfigured ? "rounded-[8px] border border-[var(--ds-ok-line)] bg-[var(--ds-ok-soft)] px-3 py-1.5 text-xs font-black text-sky-100" : "rounded-[8px] border border-[var(--ds-warn-line)] bg-[var(--ds-warn-soft)] px-3 py-1.5 text-xs font-black text-amber-100"}>
              {supabaseConfigured ? "Your workspace" : "Sign-in unavailable"}
            </span>
          </div>

          <div className="mt-9">
            <p className="ds-eyebrow">YOUR PARTS. YOUR WORKBENCH.</p>
            <h1 className="mt-3 text-4xl font-bold tracking-tight text-white">Sign in</h1>
            <p className="mt-3 text-base font-semibold leading-7 text-white/68">
              Pick up where you left off, or capture your first part.
            </p>
          </div>

          <div className="mt-8 space-y-3">
            {pendingSignOut ? <button type="button" disabled={isBusy} onClick={() => void retrySignOut()} className="h-12 w-full rounded-[8px] border border-white/20 px-4 text-sm font-bold">Retry sign out</button> : null}
            {googleAuthEnabled ? (
              <OAuthButton
                brand="G"
                disabled={isGoogleLoading || isGitHubLoading || isSubmitting}
                isLoading={isGoogleLoading}
                label="Continue with Google"
                loadingLabel="Opening Google..."
                onClick={handleGoogleSignIn}
              />
            ) : null}

            {githubAuthEnabled ? (
              <OAuthButton
                brand="GH"
                disabled={isGoogleLoading || isGitHubLoading || isSubmitting}
                isLoading={isGitHubLoading}
                label="Continue with GitHub"
                loadingLabel="Opening GitHub..."
                onClick={handleGitHubSignIn}
              />
            ) : null}

            {oauthEnabled ? (
              <div className="flex items-center py-3">
                <div className="h-px flex-1 bg-white/12" />
                <span className="mx-4 text-xs font-black uppercase tracking-[0.14em] text-white/45">Or use email</span>
                <div className="h-px flex-1 bg-white/12" />
              </div>
            ) : null}

            <form className="space-y-4" onSubmit={handleSubmit}>
              <fieldset disabled={isBusy} className="space-y-4">
              {!supabaseConfigured ? (
                <div className="rounded-[8px] border border-amber-300/30 bg-amber-500/10 px-4 py-3 text-sm font-semibold leading-6 text-amber-100">
                  Supabase auth is not configured for this build.
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-1 rounded-[8px] bg-white/10 p-1" role="tablist" aria-label="Sign in method">
                <button
                  type="button"
                  role="tab"
                  aria-selected={authMode === "link"}
                  onClick={() => switchAuthMode("link")}
                  className={authMode === "link" ? "h-11 rounded-[7px] bg-white text-sm font-black text-[var(--ds-logo-ink)] shadow-sm" : "h-11 rounded-[7px] text-sm font-black text-white/62"}
                >
                  Email link
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={authMode === "password"}
                  onClick={() => switchAuthMode("password")}
                  className={authMode === "password" ? "h-11 rounded-[7px] bg-white text-sm font-black text-[var(--ds-logo-ink)] shadow-sm" : "h-11 rounded-[7px] text-sm font-black text-white/62"}
                >
                  Account
                </button>
              </div>

              {authMode === "link" || passwordMode !== "anonymous" ? (
                <label className="block">
                  <span className="mb-2 block text-sm font-black text-white/84">Email address</span>
                  <input
                    className="h-14 w-full rounded-[8px] border border-white/12 bg-white/10 px-4 text-base font-semibold text-white shadow-sm outline-none placeholder:text-white/38 focus:border-[var(--ds-accent)] focus:ring-4 focus:ring-[var(--ds-accent-soft)] disabled:bg-white/5 disabled:text-white/64"
                    autoCapitalize="none"
                    autoComplete="email"
                    disabled={(authMode === "link" && step !== "email") || isSubmitting}
                    enterKeyHint="next"
                    inputMode="email"
                    name="email"
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@shop.com"
                    required={(authMode === "link" || passwordMode !== "anonymous") && supabaseConfigured}
                    spellCheck={false}
                    type="email"
                    value={email}
                  />
                </label>
              ) : null}

              {authMode === "password" ? (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setPasswordMode("signin")}
                      className={passwordMode === "signin" ? "h-11 rounded-[8px] border border-[var(--ds-accent)] bg-[var(--ds-accent-soft)] text-sm font-black text-white" : "h-11 rounded-[8px] border border-white/12 bg-white/5 text-sm font-black text-white/62"}
                    >
                      Sign in
                    </button>
                    <button
                      type="button"
                      onClick={() => setPasswordMode("signup")}
                      className={passwordMode === "signup" ? "h-11 rounded-[8px] border border-[var(--ds-accent)] bg-[var(--ds-accent-soft)] text-sm font-black text-white" : "h-11 rounded-[8px] border border-white/12 bg-white/5 text-sm font-black text-white/62"}
                    >
                      Create
                    </button>
                    <button
                      type="button"
                      onClick={() => setPasswordMode("anonymous")}
                      className={passwordMode === "anonymous" ? "h-11 rounded-[8px] border border-[var(--ds-accent)] bg-[var(--ds-accent-soft)] text-sm font-black text-white" : "h-11 rounded-[8px] border border-white/12 bg-white/5 text-sm font-black text-white/62"}
                    >
                      No email
                    </button>
                  </div>
                  {passwordMode !== "anonymous" ? (
                    <label className="block">
                      <span className="mb-2 block text-sm font-black text-white/84">Password</span>
                      <input
                        className="h-14 w-full rounded-[8px] border border-white/12 bg-white/10 px-4 text-base font-semibold text-white shadow-sm outline-none placeholder:text-white/38 focus:border-[var(--ds-accent)] focus:ring-4 focus:ring-[var(--ds-accent-soft)]"
                        autoComplete={passwordMode === "signup" ? "new-password" : "current-password"}
                        disabled={isSubmitting}
                        minLength={passwordMode === "signup" ? 8 : undefined}
                        name="password"
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="Your password"
                        required={supabaseConfigured}
                        type="password"
                        value={password}
                      />
                    </label>
                  ) : (
                    <p className="rounded-[8px] border border-sky-300/30 bg-sky-400/12 px-4 py-3 text-sm font-bold leading-6 text-sky-100">
                      Temporary session on this browser. After signing out or clearing browser data, you cannot sign back in to this temporary account. Use an email account for records you need to keep accessing.
                    </p>
                  )}
                </>
              ) : null}

              {authMode === "link" && step === "code" ? (
                <label className="block">
                  <span className="mb-2 block text-sm font-black text-white/84">Verification code</span>
                  <input
                    ref={codeInputRef}
                    className="h-14 w-full rounded-[8px] border border-white/12 bg-white/10 px-4 text-center text-xl font-black tracking-[0.4em] text-white shadow-sm outline-none placeholder:text-white/38 placeholder:tracking-normal focus:border-[var(--ds-accent)] focus:ring-4 focus:ring-[var(--ds-accent-soft)]"
                    autoComplete="one-time-code"
                    enterKeyHint="done"
                    inputMode="numeric"
                    maxLength={CODE_LENGTH}
                    name="verification-code"
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
                    onPaste={handleCodePaste}
                    pattern="[0-9]*"
                    placeholder="000000"
                    required
                    type="text"
                    value={code}
                  />
                </label>
              ) : null}

              {visibleNotice ? (
                <p role="status" className="rounded-[8px] border border-sky-300/30 bg-sky-400/12 px-4 py-3 text-sm font-bold leading-6 text-sky-100">
                  {visibleNotice}
                </p>
              ) : null}

              {error ? (
                <p className="rounded-[8px] border border-white/15 bg-white/8 px-4 py-3 text-sm font-bold leading-6 text-white/85" role="alert">
                  {error}
                </p>
              ) : null}

              <button
                className="h-14 w-full rounded-[8px] bg-[var(--ds-accent)] px-4 text-base font-black text-white shadow-[var(--ds-shadow-primary)] transition active:bg-[var(--ds-accent-pressed)] disabled:pointer-events-none disabled:opacity-50"
                disabled={
                  isSubmitting
                  || isGoogleLoading
                  || isGitHubLoading
                  || !canSubmit
                  || (authMode === "link" && step === "sent" && resendCooldown > 0)
                }
                type="submit"
              >
                {submitLabel(authMode, passwordMode, step, supabaseConfigured, isSubmitting)}
              </button>
              </fieldset>
            </form>
            <p className="ds-auth-footnote">Review AI suggestions before relying on them. A photo cannot confirm that a part works.</p>

            {authMode === "link" && step !== "email" ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={handleUseDifferentEmail}
                    disabled={isBusy}
                    className="h-12 rounded-[8px] border border-white/12 bg-white/5 px-3 text-sm font-black text-white shadow-sm active:bg-white/10"
                  >
                    Use another email
                  </button>
                  <button
                    type="button"
                    onClick={handleResendLink}
                    className="h-12 rounded-[8px] border border-white/12 bg-white/5 px-3 text-sm font-black text-white shadow-sm active:bg-white/10 disabled:pointer-events-none disabled:opacity-50"
                    disabled={isBusy || resendCooldown > 0}
                  >
                    {resendCooldown > 0 ? `Send in ${resendCooldown}s` : "Send another link"}
                  </button>
                </div>
                {step === "sent" ? (
                  <button
                    type="button"
                    onClick={handleShowCodeEntry}
                    disabled={isBusy}
                    className="text-sm font-black text-sky-100 underline decoration-white/30 underline-offset-4"
                  >
                    I have a code
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
      </section>
    </main>
  );
}

function StatusCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="ds-workflow-number">{label}</span>
      <span className="ds-workflow-label">{value}</span>
    </div>
  );
}

function OAuthButton({
  brand,
  disabled,
  isLoading,
  label,
  loadingLabel,
  onClick,
}: {
  brand: string;
  disabled: boolean;
  isLoading: boolean;
  label: string;
  loadingLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid h-14 w-full grid-cols-[44px_1fr_44px] items-center rounded-[8px] border border-white/12 bg-white/95 px-4 text-base font-black text-[var(--ds-logo-ink)] shadow-sm transition active:bg-white disabled:pointer-events-none disabled:opacity-50"
      disabled={disabled}
    >
      <span className="text-lg font-black text-[#24292F]" aria-hidden="true">
        {brand}
      </span>
      <span>{isLoading ? loadingLabel : label}</span>
      <span />
    </button>
  );
}

function submitLabel(
  authMode: AuthMode,
  passwordMode: PasswordMode,
  step: AuthStep,
  supabaseConfigured: boolean,
  isSubmitting: boolean,
) {
  if (isSubmitting) {
    if (authMode === "password") {
      if (passwordMode === "anonymous") {
        return "Starting session...";
      }

      return passwordMode === "signup" ? "Creating account..." : "Checking password...";
    }
    return step === "code" ? "Checking code..." : "Sending link...";
  }

  if (!supabaseConfigured) {
    return "Auth unavailable";
  }

  if (authMode === "password") {
    if (passwordMode === "anonymous") {
      return "Continue without email";
    }

    return passwordMode === "signup" ? "Create account" : "Sign in to scanner";
  }

  if (step === "code") {
    return "Verify code";
  }

  return step === "sent" ? "Send another link" : "Send sign-in link";
}
