import { FormEvent, useEffect, useState } from "react";
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
      className="min-h-dvh bg-white px-4 pb-8 pt-[max(28px,env(safe-area-inset-top))] text-neutral-900"
      style={{
        backgroundImage: "radial-gradient(circle, rgba(10,10,10,0.11) 1px, transparent 1px)",
        backgroundSize: "20px 20px",
      }}
    >
      <section className="mx-auto flex w-full max-w-[540px] flex-col items-center">
        <img src="/icon-192.png" alt="Deep Spec" className="h-16 w-16 rounded-[8px] object-cover shadow-sm" />
        <p className="mt-4 text-sm font-black text-[#b49100]">Deep Spec</p>
        <h1 className="mt-8 text-center text-3xl font-black text-neutral-900">Sign in or sign up</h1>
        <p className="mt-3 text-center text-lg font-semibold text-neutral-500">Start scanning with Deep Spec</p>

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
                className="h-14 w-full rounded-[8px] border border-neutral-200 bg-white px-4 text-base font-semibold text-neutral-900 shadow-sm outline-none placeholder:text-neutral-400 focus:border-[#FACC15] focus:ring-4 focus:ring-yellow-100 disabled:bg-neutral-100"
                disabled={step === "code" || isSubmitting}
                inputMode="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Enter your email address"
                required={supabaseConfigured}
                type="email"
                value={email}
              />
            </label>

            {step === "code" ? (
              <label className="block">
                <span className="mb-2 block text-sm font-black text-neutral-700">Verification code</span>
                <input
                  className="h-14 w-full rounded-[8px] border border-neutral-200 bg-white px-4 text-center text-xl font-black text-neutral-900 shadow-sm outline-none placeholder:text-neutral-400 focus:border-[#FACC15] focus:ring-4 focus:ring-yellow-100"
                  inputMode="numeric"
                  maxLength={8}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
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
              className="h-14 w-full rounded-[8px] bg-neutral-900 px-4 text-base font-black text-white shadow-sm transition active:bg-neutral-800 disabled:pointer-events-none disabled:opacity-50"
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
          Verification codes are handled by Supabase Auth. Deep Spec checks your session before opening scanner tools.
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
