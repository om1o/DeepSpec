import { ClipboardEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getVerifiedAuthUser,
  isGitHubAuthEnabled,
  isGoogleAuthEnabled,
  isSupabaseAuthConfigured,
  signInWithGitHub,
  signInWithPassword,
  signUpWithPassword,
  sendEmailVerificationCode,
  signInWithGoogle,
  verifyEmailCode,
} from "../services/auth";

type AuthStep = "email" | "code";
type AuthMode = "code" | "password";
type PasswordMode = "signin" | "signup";
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
  const [authMode, setAuthMode] = useState<AuthMode>("code");
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
        const normalizedEmail = email.trim().toLowerCase();
        const user = passwordMode === "signin"
          ? await signInWithPassword(normalizedEmail, password)
          : await signUpWithPassword(normalizedEmail, password);
        if (user) {
          navigate(SCAN_ROUTE, { replace: true });
          return;
        }

        setNotice("Account created. Check your email to confirm it, then sign in with your password.");
        setPasswordMode("signin");
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
      await sendEmailVerificationCode(normalizedEmail);
      setStep("code");
      setNotice(`Sign-in email sent to ${normalizedEmail}. Enter the code here, or open the link in that email.`);
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

  async function handleResendCode() {
    if (resendCooldown > 0) return;
    setError(null);
    setNotice(null);
    setIsSubmitting(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      await sendEmailVerificationCode(normalizedEmail);
      setNotice(`New sign-in email sent to ${normalizedEmail}.`);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      autoSubmittedCodeRef.current = null;
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Could not resend the code. Try again.");
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
      <main className="flex min-h-dvh items-center justify-center bg-[var(--ds-page)] px-4 text-center text-sm font-bold text-slate-500">
        <div className="rounded-full bg-white px-5 py-3 shadow-sm ring-1 ring-slate-200">
          Checking your session...
        </div>
      </main>
    );
  }

  return (
    <main
      className="min-h-dvh overflow-hidden bg-[var(--ds-page)] px-4 pb-8 pt-[max(20px,env(safe-area-inset-top))] text-slate-950"
      style={{
        backgroundImage: "linear-gradient(135deg, rgba(11,116,255,0.14), transparent 34%), radial-gradient(circle, rgba(11,116,255,0.10) 1px, transparent 1px)",
        backgroundSize: "auto, 22px 22px",
      }}
    >
      <section className="mx-auto grid min-h-[calc(100dvh-48px)] w-full max-w-6xl items-center gap-5 lg:grid-cols-[1.04fr_0.96fr] lg:gap-8">
        <div className="relative hidden min-h-[640px] overflow-hidden rounded-[8px] bg-slate-950 shadow-[0_24px_90px_rgba(15,23,42,0.22)] lg:block">
          <img src="/test-fixtures/engine-scan-test.jpg" alt="" className="absolute inset-0 h-full w-full object-cover opacity-72" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,21,34,0.36),rgba(6,21,34,0.72)),linear-gradient(90deg,rgba(6,21,34,0.86),rgba(6,21,34,0.18))]" />
          <div className="absolute left-8 right-8 top-8 flex items-center justify-between">
            <img src="/brand/deepspec-logo.png" alt="Deep Spec" className="h-14 w-44 rounded-[8px] bg-white object-contain p-1.5 shadow-sm ring-1 ring-white/20" />
            <span className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-black uppercase text-white backdrop-blur-md">
              Supabase verified
            </span>
          </div>
          <div className="absolute inset-x-10 bottom-10 space-y-5 text-white">
            <div className="max-w-xl">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-white/70">Private scan workspace</p>
              <h2 className="mt-3 text-4xl font-black leading-[1.04] tracking-tight">Log in before scan history touches the cloud.</h2>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <StatusCell label="Auth" value="Email code" />
              <StatusCell label="Storage" value="Private bucket" />
              <StatusCell label="RLS" value="Owner rows" />
            </div>
          </div>
        </div>

        <section className="mx-auto flex w-full max-w-[540px] flex-col rounded-[8px] bg-white p-5 shadow-[0_20px_70px_rgba(15,23,42,0.14)] ring-1 ring-slate-200 sm:p-7">
          <div className="flex items-center justify-between gap-4">
            <img src="/brand/deepspec-logo.png" alt="Deep Spec" className="h-14 w-44 rounded-[8px] bg-white object-contain p-1 shadow-sm ring-1 ring-[var(--ds-accent-line)]" />
            <span className={supabaseConfigured ? "rounded-full bg-[var(--ds-ok-soft)] px-3 py-1.5 text-xs font-black text-[var(--ds-ok-ink)]" : "rounded-full bg-[var(--ds-warn-soft)] px-3 py-1.5 text-xs font-black text-[var(--ds-warn-ink)]"}>
              {supabaseConfigured ? "Cloud ready" : "Auth offline"}
            </span>
          </div>

          <div className="mt-9">
            <p className="text-sm font-black text-[var(--ds-accent)]">Deep Spec account</p>
            <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-950">Sign in</h1>
            <p className="mt-3 text-base font-semibold leading-7 text-slate-500">
              Use an email code, sign-in link, or confirmed password account. Deep Spec opens only after Supabase verifies the session.
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
                <div className="h-px flex-1 bg-slate-200" />
                <span className="mx-4 text-xs font-black uppercase tracking-[0.14em] text-slate-400">Or use email</span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
            ) : null}

            <form className="space-y-4" onSubmit={handleSubmit}>
              {!supabaseConfigured ? (
                <div className="rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-900">
                  Supabase auth is not configured for this build.
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-1 rounded-[8px] bg-slate-100 p-1" role="tablist" aria-label="Sign in method">
                <button
                  type="button"
                  role="tab"
                  aria-selected={authMode === "code"}
                  onClick={() => switchAuthMode("code")}
                  className={authMode === "code" ? "h-11 rounded-[7px] bg-white text-sm font-black text-slate-950 shadow-sm ring-1 ring-slate-200" : "h-11 rounded-[7px] text-sm font-black text-slate-500"}
                >
                  Email code
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={authMode === "password"}
                  onClick={() => switchAuthMode("password")}
                  className={authMode === "password" ? "h-11 rounded-[7px] bg-white text-sm font-black text-slate-950 shadow-sm ring-1 ring-slate-200" : "h-11 rounded-[7px] text-sm font-black text-slate-500"}
                >
                  Password
                </button>
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-black text-slate-700">Email address</span>
                <input
                  className="h-14 w-full rounded-[8px] border border-slate-200 bg-white px-4 text-base font-semibold text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-[var(--ds-accent)] focus:ring-4 focus:ring-[var(--ds-accent-soft)] disabled:bg-slate-100"
                  autoCapitalize="none"
                  autoComplete="email"
                  disabled={(authMode === "code" && step === "code") || isSubmitting}
                  enterKeyHint="next"
                  inputMode="email"
                  name="email"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Enter your email address"
                  required={supabaseConfigured}
                  spellCheck={false}
                  type="email"
                  value={email}
                />
              </label>

              {authMode === "password" ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPasswordMode("signin")}
                      className={passwordMode === "signin" ? "h-11 rounded-[8px] border border-[var(--ds-accent)] bg-[var(--ds-accent-soft)] text-sm font-black text-[var(--ds-accent)]" : "h-11 rounded-[8px] border border-slate-200 bg-white text-sm font-black text-slate-500"}
                    >
                      Existing account
                    </button>
                    <button
                      type="button"
                      onClick={() => setPasswordMode("signup")}
                      className={passwordMode === "signup" ? "h-11 rounded-[8px] border border-[var(--ds-accent)] bg-[var(--ds-accent-soft)] text-sm font-black text-[var(--ds-accent)]" : "h-11 rounded-[8px] border border-slate-200 bg-white text-sm font-black text-slate-500"}
                    >
                      New account
                    </button>
                  </div>
                  <label className="block">
                    <span className="mb-2 block text-sm font-black text-slate-700">Password</span>
                    <input
                      className="h-14 w-full rounded-[8px] border border-slate-200 bg-white px-4 text-base font-semibold text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-[var(--ds-accent)] focus:ring-4 focus:ring-[var(--ds-accent-soft)]"
                      autoComplete={passwordMode === "signin" ? "current-password" : "new-password"}
                      disabled={isSubmitting}
                      minLength={8}
                      name="password"
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder={passwordMode === "signin" ? "Enter your password" : "Create a password"}
                      required={authMode === "password" && supabaseConfigured}
                      type="password"
                      value={password}
                    />
                  </label>
                </>
              ) : null}

              {authMode === "code" && step === "code" ? (
                <label className="block">
                  <span className="mb-2 block text-sm font-black text-slate-700">Verification code</span>
                  <input
                    ref={codeInputRef}
                    className="h-14 w-full rounded-[8px] border border-slate-200 bg-white px-4 text-center text-xl font-black tracking-[0.4em] text-slate-950 shadow-sm outline-none placeholder:text-slate-400 placeholder:tracking-normal focus:border-[var(--ds-accent)] focus:ring-4 focus:ring-[var(--ds-accent-soft)]"
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
                <p className="rounded-[8px] border border-[var(--ds-ok-line)] bg-[var(--ds-ok-soft)] px-4 py-3 text-sm font-bold text-[var(--ds-ok-ink)]">
                  {notice}
                </p>
              ) : null}

              {error ? (
                <p className="rounded-[8px] border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700" role="alert">
                  {error}
                </p>
              ) : null}

              <button
                className="h-14 w-full rounded-[8px] bg-[var(--ds-accent)] px-4 text-base font-black text-white shadow-[var(--ds-shadow-primary)] transition active:bg-[var(--ds-accent-pressed)] disabled:pointer-events-none disabled:opacity-50"
                disabled={isSubmitting || isGoogleLoading || isGitHubLoading || !canSubmit}
                type="submit"
              >
                {submitLabel(authMode, passwordMode, step, supabaseConfigured, isSubmitting)}
              </button>
            </form>

            {authMode === "code" && step === "code" ? (
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={handleUseDifferentEmail}
                  className="h-12 rounded-[8px] border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 shadow-sm active:bg-slate-50"
                >
                  Use another email
                </button>
                <button
                  type="button"
                  onClick={handleResendCode}
                  className="h-12 rounded-[8px] border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 shadow-sm active:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
                  disabled={isSubmitting || resendCooldown > 0}
                >
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
                </button>
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
      className="grid h-14 w-full grid-cols-[44px_1fr_44px] items-center rounded-[8px] border border-neutral-200 bg-white px-4 text-base font-black text-neutral-800 shadow-sm transition active:bg-neutral-50 disabled:pointer-events-none disabled:opacity-50"
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
      return passwordMode === "signin" ? "Checking password..." : "Creating account...";
    }
    return step === "email" ? "Sending email..." : "Checking code...";
  }

  if (!supabaseConfigured) {
    return "Auth unavailable";
  }

  if (authMode === "password") {
    return passwordMode === "signin" ? "Sign in with password" : "Create password account";
  }

  return step === "email" ? "Send sign-in email" : "Verify code";
}
