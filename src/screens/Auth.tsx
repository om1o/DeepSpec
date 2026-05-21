import { FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getVerifiedAuthUser,
  isSupabaseAuthConfigured,
  markLocalAuthBypass,
  sendEmailVerificationCode,
  signInWithGoogle,
  verifyEmailCode,
} from "../services/auth";

type AuthStep = "email" | "code";

export default function Auth() {
  const navigate = useNavigate();
  const supabaseConfigured = isSupabaseAuthConfigured();
  const [step, setStep] = useState<AuthStep>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const codeInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let isMounted = true;

    getVerifiedAuthUser()
      .then((user) => {
        if (user) {
          navigate("/", { replace: true });
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (!supabaseConfigured) {
      handleLocalContinue();
      return;
    }

    setIsSubmitting(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();

      if (step === "email") {
        await sendEmailVerificationCode(normalizedEmail);
        setStep("code");
        setNotice(`Verification code sent to ${normalizedEmail}.`);
        return;
      }

      await verifyEmailCode(normalizedEmail, code.trim());
      navigate("/", { replace: true });
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
    setError(null);
    setNotice(null);
    setIsSubmitting(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      await sendEmailVerificationCode(normalizedEmail);
      setNotice(`New verification code sent to ${normalizedEmail}.`);
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "Could not resend the code. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleUseDifferentEmail() {
    setStep("email");
    setCode("");
    setError(null);
    setNotice(null);
  }

  function handleLocalContinue() {
    markLocalAuthBypass();
    navigate("/", { replace: true });
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
        backgroundImage: "radial-gradient(circle, rgba(37,99,235,0.10) 1px, transparent 1px)",
        backgroundSize: "20px 20px",
      }}
    >
      <section className="mx-auto flex w-full max-w-[540px] flex-col items-center">
        <img src="/brand/deepspec-logo.png" alt="Deep Spec" className="h-28 w-full max-w-xs rounded-[14px] bg-white object-contain p-2 shadow-sm ring-1 ring-slate-200" />
        <p className="mt-5 text-sm font-black text-[var(--ds-accent)]">Deep Spec</p>
        <h1 className="mt-7 text-center text-3xl font-black text-slate-950">Sign in with a code</h1>
        <p className="mt-3 text-center text-lg font-semibold text-slate-500">No password. No setup link.</p>

        <div className="mt-16 w-full space-y-3">
          {supabaseConfigured ? (
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

          {supabaseConfigured ? (
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

            <label className="block">
              <span className="sr-only">Email address</span>
              <input
                className="h-14 w-full rounded-[8px] border border-slate-200 bg-white px-4 text-base font-semibold text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-[var(--ds-accent)] focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100"
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
                  className="h-14 w-full rounded-[8px] border border-slate-200 bg-white px-4 text-center text-xl font-black text-slate-950 shadow-sm outline-none placeholder:text-slate-400 focus:border-[var(--ds-accent)] focus:ring-4 focus:ring-blue-100"
                  autoComplete="one-time-code"
                  enterKeyHint="done"
                  inputMode="numeric"
                  maxLength={8}
                  name="verification-code"
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                  pattern="[0-9]*"
                  placeholder="000000"
                  required
                  type="text"
                  value={code}
                />
              </label>
            ) : null}

            {notice ? (
              <p className="rounded-[8px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
                {notice}
              </p>
            ) : null}

            {error ? (
              <p className="rounded-[8px] border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700" role="alert">
                {error}
              </p>
            ) : null}

            <button
              className="h-14 w-full rounded-[8px] bg-[var(--ds-accent)] px-4 text-base font-black text-white shadow-[var(--ds-shadow-primary)] transition active:bg-blue-700 disabled:pointer-events-none disabled:opacity-50"
              disabled={isSubmitting || isGoogleLoading}
              type="submit"
            >
              {submitLabel(step, supabaseConfigured, isSubmitting)}
            </button>
          </form>

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
                disabled={isSubmitting}
              >
                Resend code
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

function submitLabel(step: AuthStep, supabaseConfigured: boolean, isSubmitting: boolean) {
  if (isSubmitting) {
    return step === "email" ? "Sending code..." : "Checking code...";
  }

  if (!supabaseConfigured) {
    return "Continue locally";
  }

  return step === "email" ? "Send verification code" : "Verify code";
}
