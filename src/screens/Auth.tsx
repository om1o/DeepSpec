import { ClipboardEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getVerifiedAuthUser,
  isGoogleAuthEnabled,
  isSupabaseAuthConfigured,
  markLocalAuthBypass,
  sendEmailVerificationCode,
  signInWithGoogle,
  verifyEmailCode,
} from "../services/auth";

type AuthStep = "email" | "code";
const SCAN_ROUTE = "/scan";
const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 30;

export default function Auth() {
  const navigate = useNavigate();
  const supabaseConfigured = isSupabaseAuthConfigured();
  const googleAuthEnabled = isGoogleAuthEnabled();
  const localDevBypassEnabled = import.meta.env.DEV;
  const canSubmit = supabaseConfigured || localDevBypassEnabled;
  const [step, setStep] = useState<AuthStep>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
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
      if (localDevBypassEnabled) {
        handleLocalContinue();
      } else {
        setError("Supabase auth is not configured for this build.");
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
      setNotice(`Verification code sent to ${normalizedEmail}.`);
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

  async function handleResendCode() {
    if (resendCooldown > 0) return;
    setError(null);
    setNotice(null);
    setIsSubmitting(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      await sendEmailVerificationCode(normalizedEmail);
      setNotice(`New verification code sent to ${normalizedEmail}.`);
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

  function handleLocalContinue() {
    markLocalAuthBypass();
    navigate(SCAN_ROUTE, { replace: true });
  }

  if (isCheckingSession) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-white px-4 text-center text-sm font-bold text-neutral-500">
        Checking your session...
      </main>
    );
  }

  return (
    <main
      className="min-h-dvh bg-[var(--ds-page)] px-4 pb-8 pt-[max(28px,env(safe-area-inset-top))] text-slate-950"
      style={{
        backgroundImage: "radial-gradient(circle, rgba(11,116,255,0.10) 1px, transparent 1px)",
        backgroundSize: "20px 20px",
      }}
    >
      <section className="mx-auto flex w-full max-w-[540px] flex-col items-center">
        <img src="/brand/deepspec-logo.png" alt="Deep Spec" className="h-28 w-full max-w-xs rounded-[14px] bg-white object-contain p-2 shadow-sm ring-1 ring-[var(--ds-accent-line)]" />
        <p className="mt-5 text-sm font-black text-[var(--ds-accent)]">Deep Spec</p>
        <h1 className="mt-7 text-center text-3xl font-black text-slate-950">Sign in with a code</h1>
        <p className="mt-3 text-center text-lg font-semibold text-slate-500">No password. No magic link.</p>

        <div className="mt-16 w-full space-y-3">
          {googleAuthEnabled ? (
            <button
              type="button"
              onClick={handleGoogleSignIn}
              className="grid h-14 w-full grid-cols-[44px_1fr_44px] items-center rounded-[8px] border border-neutral-200 bg-white px-4 text-base font-black text-neutral-800 shadow-sm transition active:bg-neutral-50 disabled:pointer-events-none disabled:opacity-50"
              disabled={isGoogleLoading || isSubmitting}
            >
              <span className="text-xl font-black text-[#4285F4]" aria-hidden="true">
                G
              </span>
              <span>{isGoogleLoading ? "Opening Google..." : "Continue with Google"}</span>
              <span />
            </button>
          ) : null}

          {googleAuthEnabled ? (
            <div className="flex items-center py-5">
              <div className="h-px flex-1 bg-neutral-200" />
              <span className="mx-4 text-sm font-semibold text-neutral-400">Or</span>
              <div className="h-px flex-1 bg-neutral-200" />
            </div>
          ) : null}

          <form className="space-y-3" onSubmit={handleSubmit}>
            {!supabaseConfigured ? (
              <div className="rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-900">
                Supabase auth is not configured for this build. Local continue is only available for development.
              </div>
            ) : null}
            {localDevBypassEnabled && supabaseConfigured ? (
              <div className="rounded-[8px] border border-[var(--ds-accent-line)] bg-[var(--ds-accent-soft)] px-4 py-3 text-sm font-semibold leading-6 text-[var(--ds-ok-ink)]">
                Local browser QA can continue without sending an email code.
              </div>
            ) : null}

            <label className="block">
              <span className="sr-only">Email address</span>
              <input
                className="h-14 w-full rounded-[8px] border border-slate-200 bg-white px-4 text-base font-semibold text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-[var(--ds-accent)] focus:ring-4 focus:ring-[var(--ds-accent-soft)] disabled:bg-slate-100"
                autoCapitalize="none"
                autoComplete="email"
                disabled={step === "code" || isSubmitting}
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

            {step === "code" ? (
              <label className="block">
                <span className="mb-2 block text-sm font-black text-neutral-700">Verification code</span>
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
              disabled={isSubmitting || isGoogleLoading || !canSubmit}
              type="submit"
            >
              {submitLabel(step, supabaseConfigured, localDevBypassEnabled, isSubmitting)}
            </button>
          </form>

          {localDevBypassEnabled && supabaseConfigured ? (
            <button
              type="button"
              onClick={handleLocalContinue}
              className="h-12 w-full rounded-[8px] border border-neutral-200 bg-white px-3 text-sm font-black text-neutral-700 shadow-sm active:bg-neutral-50"
            >
              Continue locally
            </button>
          ) : null}

          {step === "code" ? (
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={handleUseDifferentEmail}
                className="h-12 rounded-[8px] border border-neutral-200 bg-white px-3 text-sm font-black text-neutral-700 shadow-sm active:bg-neutral-50"
              >
                Use another email
              </button>
              <button
                type="button"
                onClick={handleResendCode}
                className="h-12 rounded-[8px] border border-neutral-200 bg-white px-3 text-sm font-black text-neutral-700 shadow-sm active:bg-neutral-50 disabled:pointer-events-none disabled:opacity-50"
                disabled={isSubmitting || resendCooldown > 0}
              >
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
              </button>
            </div>
          ) : null}
        </div>

        <p className="mt-8 max-w-sm text-center text-xs font-semibold leading-5 text-neutral-500">
          Use the one-time code from your email to continue.
        </p>
      </section>
    </main>
  );
}

function submitLabel(
  step: AuthStep,
  supabaseConfigured: boolean,
  localDevBypassEnabled: boolean,
  isSubmitting: boolean,
) {
  if (isSubmitting) {
    return step === "email" ? "Sending code..." : "Checking code...";
  }

  if (!supabaseConfigured) {
    return localDevBypassEnabled ? "Continue locally" : "Auth unavailable";
  }

  return step === "email" ? "Send verification code" : "Verify code";
}
