import { ClipboardEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getVerifiedAuthUser,
  isGitHubAuthEnabled,
  isGoogleAuthEnabled,
  isSupabaseAuthConfigured,
  sendEmailSignInLink,
  signInAnonymously,
  signInWithGitHub,
  signInWithGoogle,
  signInWithPassword,
  verifyEmailCode,
} from "../services/auth";

type AuthStep = "email" | "sent" | "code";
type AuthMode = "link" | "password";
type PasswordMode = "signin" | "anonymous";
const SCAN_ROUTE = "/scan";
const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 30;

export default function Auth() {
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
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isGitHubLoading, setIsGitHubLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const codeInputRef = useRef<HTMLInputElement | null>(null);
  const autoSubmittedCodeRef = useRef<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    getVerifiedAuthUser()
      .then((user) => {
        if (user) {
          navigate(SCAN_ROUTE, { replace: true });
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
  }, [navigate]);

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
    if (isSubmitting || !supabaseConfigured) return;
    setError(null);
    setNotice(null);
    setIsSubmitting(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      await verifyEmailCode(normalizedEmail, code.trim());
      navigate(SCAN_ROUTE, { replace: true });
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Authentication failed. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }, [code, email, isSubmitting, navigate, supabaseConfigured]);

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
    setError(null);
    setNotice(null);

    if (!supabaseConfigured) {
      setError("Supabase auth is not configured for this build.");
      return;
    }

    if (authMode === "password") {
      setIsSubmitting(true);
      try {
        const user = passwordMode === "signin"
          ? await signInWithPassword(email.trim().toLowerCase(), password)
          : await signInAnonymously();
        if (user) {
          navigate(SCAN_ROUTE, { replace: true });
          return;
        }
      } catch (authError) {
        setError(authError instanceof Error ? authError.message : "Password authentication failed. Try again.");
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (step === "code") {
      await verifyCurrentCode();
      return;
    }

    setIsSubmitting(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      await sendEmailSignInLink(normalizedEmail);
      setStep("sent");
      setNotice(`Sign-in link sent to ${normalizedEmail}. Open it from your email to finish login.`);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Authentication failed. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleSignIn() {
    setError(null);
    setNotice(null);
    setIsGoogleLoading(true);

    try {
      await signInWithGoogle();
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Google sign in failed. Try again.");
      setIsGoogleLoading(false);
    }
  }

  async function handleGitHubSignIn() {
    setError(null);
    setNotice(null);
    setIsGitHubLoading(true);

    try {
      await signInWithGitHub();
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "GitHub sign in failed. Try again.");
      setIsGitHubLoading(false);
    }
  }

  async function handleResendLink() {
    if (resendCooldown > 0) return;
    setError(null);
    setNotice(null);
    setIsSubmitting(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      await sendEmailSignInLink(normalizedEmail);
      setNotice(`New sign-in link sent to ${normalizedEmail}.`);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      autoSubmittedCodeRef.current = null;
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Could not send another link. Try again.");
    } finally {
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
    setNotice("Enter the 6-digit code from your email.");
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
          Checking your session...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh overflow-hidden bg-[var(--ds-bg)] px-4 pb-8 pt-[max(20px,env(safe-area-inset-top))] text-white">
      <section className="mx-auto grid min-h-[calc(100dvh-48px)] w-full max-w-6xl items-center gap-5 lg:grid-cols-[1.02fr_0.98fr] lg:gap-8">
        <div className="relative hidden min-h-[640px] overflow-hidden rounded-[8px] border border-white/10 bg-slate-950 shadow-[0_24px_90px_rgba(0,0,0,0.36)] lg:block">
          <img src="/test-fixtures/engine-scan-test.jpg" alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,21,34,0.30),rgba(6,21,34,0.82)),linear-gradient(90deg,rgba(6,21,34,0.92),rgba(6,21,34,0.24))]" />
          <div className="scanner-corner scanner-corner-tl left-6 top-6" />
          <div className="scanner-corner scanner-corner-tr right-6 top-6" />
          <div className="scanner-corner scanner-corner-bl bottom-6 left-6" />
          <div className="scanner-corner scanner-corner-br bottom-6 right-6" />
          <div className="absolute left-8 right-8 top-8 flex items-center justify-between">
            <img src="/brand/deepspec-logo.png" alt="Deep Spec" className="h-14 w-44 rounded-[8px] bg-white object-contain p-1.5 shadow-sm ring-1 ring-white/20" />
            <span className="rounded-[8px] border border-white/20 bg-white/10 px-4 py-2 text-xs font-black uppercase text-white backdrop-blur-md">
              Supabase auth
            </span>
          </div>
          <div className="absolute inset-x-10 bottom-10 space-y-5 text-white">
            <div className="max-w-xl">
              <p className="text-sm font-black uppercase tracking-[0.16em] text-[var(--ds-accent)]">Protected scanner access</p>
              <h1 className="mt-3 text-5xl font-black leading-none">Login that matches the shop floor.</h1>
              <p className="mt-4 max-w-lg text-base font-semibold leading-7 text-white/74">
                Deep Spec opens only after Supabase returns a verified user session.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <StatusCell label="Auth" value="Password first" />
              <StatusCell label="Email" value="Optional" />
              <StatusCell label="Session" value="Verified" />
            </div>
          </div>
        </div>

        <section className="mx-auto flex w-full max-w-[540px] flex-col rounded-[8px] border border-white/12 bg-white/[0.07] p-5 shadow-[0_20px_70px_rgba(0,0,0,0.26)] backdrop-blur-xl sm:p-7">
          <div className="flex items-center justify-between gap-4">
            <img src="/brand/deepspec-logo.png" alt="Deep Spec" className="h-14 w-44 rounded-[8px] bg-white object-contain p-1 shadow-sm ring-1 ring-white/20" />
            <span className={supabaseConfigured ? "rounded-[8px] border border-[var(--ds-ok-line)] bg-[var(--ds-ok-soft)] px-3 py-1.5 text-xs font-black text-sky-100" : "rounded-[8px] border border-[var(--ds-warn-line)] bg-[var(--ds-warn-soft)] px-3 py-1.5 text-xs font-black text-amber-100"}>
              {supabaseConfigured ? "Cloud ready" : "Auth offline"}
            </span>
          </div>

          <div className="mt-9">
            <p className="text-sm font-black uppercase tracking-[0.14em] text-[var(--ds-accent)]">Deep Spec account</p>
            <h1 className="mt-3 text-4xl font-black tracking-normal text-white">Sign in</h1>
            <p className="mt-3 text-base font-semibold leading-7 text-white/68">
              Use an existing password account or start a private Supabase session without email.
            </p>
          </div>

          <div className="mt-8 space-y-3">
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
                  Password
                </button>
              </div>

              {authMode === "link" || passwordMode === "signin" ? (
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
                    placeholder="Enter your email address"
                    required={(authMode === "link" || passwordMode === "signin") && supabaseConfigured}
                    spellCheck={false}
                    type="email"
                    value={email}
                  />
                </label>
              ) : null}

              {authMode === "password" ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPasswordMode("signin")}
                      className={passwordMode === "signin" ? "h-11 rounded-[8px] border border-[var(--ds-accent)] bg-[var(--ds-accent-soft)] text-sm font-black text-white" : "h-11 rounded-[8px] border border-white/12 bg-white/5 text-sm font-black text-white/62"}
                    >
                      Existing account
                    </button>
                    <button
                      type="button"
                      onClick={() => setPasswordMode("anonymous")}
                      className={passwordMode === "anonymous" ? "h-11 rounded-[8px] border border-[var(--ds-accent)] bg-[var(--ds-accent-soft)] text-sm font-black text-white" : "h-11 rounded-[8px] border border-white/12 bg-white/5 text-sm font-black text-white/62"}
                    >
                      No email
                    </button>
                  </div>
                  {passwordMode === "signin" ? (
                    <label className="block">
                      <span className="mb-2 block text-sm font-black text-white/84">Password</span>
                      <input
                        className="h-14 w-full rounded-[8px] border border-white/12 bg-white/10 px-4 text-base font-semibold text-white shadow-sm outline-none placeholder:text-white/38 focus:border-[var(--ds-accent)] focus:ring-4 focus:ring-[var(--ds-accent-soft)]"
                        autoComplete="current-password"
                        disabled={isSubmitting}
                        minLength={8}
                        name="password"
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="Enter your password"
                        required={authMode === "password" && passwordMode === "signin" && supabaseConfigured}
                        type="password"
                        value={password}
                      />
                    </label>
                  ) : (
                    <p className="rounded-[8px] border border-sky-300/30 bg-sky-400/12 px-4 py-3 text-sm font-bold leading-6 text-sky-100">
                      No email confirmation required.
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

              {notice ? (
                <p className="rounded-[8px] border border-sky-300/30 bg-sky-400/12 px-4 py-3 text-sm font-bold leading-6 text-sky-100">
                  {notice}
                </p>
              ) : null}

              {error ? (
                <p className="rounded-[8px] border border-red-300/30 bg-red-500/10 px-4 py-3 text-sm font-bold leading-6 text-red-100" role="alert">
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
            </form>

            {authMode === "link" && step !== "email" ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={handleUseDifferentEmail}
                    className="h-12 rounded-[8px] border border-white/12 bg-white/5 px-3 text-sm font-black text-white shadow-sm active:bg-white/10"
                  >
                    Use another email
                  </button>
                  <button
                    type="button"
                    onClick={handleResendLink}
                    className="h-12 rounded-[8px] border border-white/12 bg-white/5 px-3 text-sm font-black text-white shadow-sm active:bg-white/10 disabled:pointer-events-none disabled:opacity-50"
                    disabled={isSubmitting || resendCooldown > 0}
                  >
                    {resendCooldown > 0 ? `Send in ${resendCooldown}s` : "Send another link"}
                  </button>
                </div>
                {step === "sent" ? (
                  <button
                    type="button"
                    onClick={handleShowCodeEntry}
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
    <div className="rounded-[8px] border border-white/15 bg-white/10 p-4 backdrop-blur-md">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-white/60">{label}</p>
      <p className="mt-2 text-sm font-black text-white">{value}</p>
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
      return passwordMode === "signin" ? "Checking password..." : "Starting session...";
    }
    return step === "code" ? "Checking code..." : "Sending link...";
  }

  if (!supabaseConfigured) {
    return "Auth unavailable";
  }

  if (authMode === "password") {
    return passwordMode === "signin" ? "Sign in with password" : "Continue without email";
  }

  if (step === "code") {
    return "Verify code";
  }

  return step === "sent" ? "Send another link" : "Send sign-in link";
}
