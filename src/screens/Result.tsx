import { Link, useLocation } from "react-router-dom";
import Button from "../components/ui/Button";
import { readLatestCapturedFrame } from "../lib/utils";
import type { CapturedFrame } from "../types";

export default function Result() {
  const location = useLocation();
  const frame = (location.state as CapturedFrame | null) ?? readLatestCapturedFrame();
  const capturedAt = frame?.capturedAt ? new Date(frame.capturedAt).toLocaleString() : null;

  return (
    <main className="min-h-dvh bg-[#0A0A0A] px-4 pb-8 pt-[max(18px,env(safe-area-inset-top))] text-white">
      <div className="mx-auto flex min-h-[calc(100dvh-48px)] w-full max-w-md flex-col">
        <header className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-[13px] font-extrabold uppercase tracking-[0.18em] text-white/70">Deep Spec</p>
            <h1 className="mt-2 text-2xl font-extrabold tracking-tight">Captured frame</h1>
          </div>
          <Link to="/" className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white">
            Back
          </Link>
        </header>

        {frame?.imageBase64 ? (
          <img
            alt="Captured car part"
            className="aspect-[3/4] w-full rounded-[24px] border border-white/10 bg-black object-contain shadow-2xl"
            src={frame.imageBase64}
          />
        ) : (
          <div className="grid aspect-[3/4] w-full place-items-center rounded-[24px] border border-dashed border-white/15 bg-[#171717] px-8 text-center text-sm text-[#A1A1AA]">
            No captured frame yet.
          </div>
        )}

        <section className="mt-5 rounded-[24px] border border-white/10 bg-[#171717] p-5">
          <p className="text-sm font-bold text-[#FACC15]">Not analyzed yet</p>
          <h2 className="mt-2 text-xl font-extrabold tracking-tight">Phase 2 will identify this</h2>
          <p className="mt-3 text-sm leading-6 text-[#A1A1AA]">
            The scanner captured and compressed this frame. AI identification is intentionally not included yet.
          </p>
          {capturedAt ? <p className="mt-3 text-xs font-semibold text-white/42">Captured {capturedAt}</p> : null}
        </section>

        <Button className="mt-auto w-full" onClick={() => window.location.assign("/")}>
          Try another scan
        </Button>
      </div>
    </main>
  );
}
