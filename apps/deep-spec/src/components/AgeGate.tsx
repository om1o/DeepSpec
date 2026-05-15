import { AGE_CONFIRMED_LS_KEY } from "../lib/ageGate";

export default function AgeGate({ onConfirmed }: { onConfirmed: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-ds-bg px-6 py-12 text-center text-ds-text">
      <div className="max-w-md rounded-2xl border border-ds-border bg-ds-card p-8 shadow-xl">
        <h1 className="mb-3 text-xl font-semibold tracking-tight">Age check</h1>
        <p className="mb-8 text-[15px] leading-relaxed text-ds-muted">
          Deep Spec is built for teens and adults. You must confirm you are <strong>13 or older</strong> before using
          the app. Parents and guardians supervise younger builders.
        </p>
        <p className="mb-10 text-[13px] text-ds-muted">
          This button is{" "}
          <strong className="text-ds-text">not legal proof of age</strong> — swap in your lawyer-reviewed flow before
          public launch.
        </p>
        <button
          type="button"
          className="w-full rounded-xl bg-ds-primary py-4 text-[16px] font-semibold text-white transition-opacity hover:opacity-95"
          onClick={() => {
            localStorage.setItem(AGE_CONFIRMED_LS_KEY, "yes");
            onConfirmed();
          }}
        >
          I am 13 or older
        </button>
      </div>
    </div>
  );
}
