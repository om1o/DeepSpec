import { useState } from "react";
import type { CSSProperties } from "react";
import type { VisualFocusBox, VisualFocusMode } from "../../types";
import type { DerivedIssue } from "../../lib/resultFacts";
import ScanThumb from "../ui/ScanThumb";

type IsolatedPartViewProps = {
  frameBase64: string;
  isolatedImageBase64?: string;
  focusBox?: VisualFocusBox;
  focusMode: VisualFocusMode;
  label: string;
  issue?: DerivedIssue | null;
  variant: "scanner" | "result";
  isVisible?: boolean;
};

const DEFAULT_BOX: VisualFocusBox = { confidence: 0, height: 0.4, width: 0.68, x: 0.16, y: 0.28 };

/**
 * The AR isolation layer. Blurs the captured frame and lifts the identified part out of it:
 * - Tier A ("mask" + cutout): the real transparent cutout, sharp, over a blurred frame.
 * - Tier B ("crop"): a sharp window of the same frame, clip-aligned with the blur.
 * - Tier C ("full_frame" / no box): the full frame, sharp (old/cloud scans degrade here).
 * Shared by the scanner review and the saved Result page.
 */
export function IsolatedPartView({
  frameBase64,
  isolatedImageBase64,
  focusBox,
  focusMode,
  label,
  issue,
  variant,
  isVisible = true,
}: IsolatedPartViewProps) {
  const [failedCutoutSource, setFailedCutoutSource] = useState<string | null>(null);

  if (!isVisible || !frameBase64) {
    return null;
  }

  const hasBox = Boolean(focusBox);
  const box = focusBox ?? DEFAULT_BOX;
  const showCutout = focusMode === "mask" && Boolean(isolatedImageBase64) && failedCutoutSource !== isolatedImageBase64;
  const showCropWindow = !showCutout && hasBox && (focusMode === "crop" || focusMode === "mask");
  const blurBackground = showCutout || showCropWindow;
  const anchor = issue?.anchor ?? null;

  const testId = variant === "scanner" ? "focused-part-overlay" : "result-focus-frame";
  const containerClass = variant === "scanner" ? "fixed inset-0 z-40" : "absolute inset-0";
  const frameAlt = variant === "scanner" ? "Reviewed scan photo" : "Captured car part";

  return (
    <div
      aria-label="Isolated part view"
      className={`pointer-events-none ${containerClass}`}
      data-focus-mode={focusMode}
      data-testid={testId}
    >
      {/* Background: the captured frame, blurred + dimmed when a part is isolated */}
      <ScanThumb
        alt={frameAlt}
        className={`absolute inset-0 h-full w-full object-cover ${blurBackground ? "scale-105 blur-[14px] brightness-[0.55]" : ""}`}
        src={frameBase64}
      />
      {blurBackground ? <div aria-hidden className="absolute inset-0 bg-slate-950/45" /> : null}

      {/* Tier A: the true cutout, sharp, sitting where the part is */}
      {showCutout ? (
        <img
          alt={`Isolated ${label}`}
          className="absolute object-contain drop-shadow-[0_18px_40px_rgba(2,6,23,0.55)]"
          data-testid="isolated-part-image"
          src={isolatedImageBase64}
          style={percentBox(box)}
          onError={() => setFailedCutoutSource(isolatedImageBase64 ?? null)}
        />
      ) : null}

      {/* Tier B: a sharp window cut out of the same frame, aligned with the blur underneath */}
      {showCropWindow ? (
        <img
          aria-hidden
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          src={frameBase64}
          style={{ clipPath: clipFor(box) }}
        />
      ) : null}

      {/* The focus frame (always present so the part stays clearly outlined) */}
      <div
        className="absolute rounded-[18px]"
        data-testid="focused-part-window"
        style={{ ...percentBox(box), outline: "2px solid rgba(255,255,255,0.92)", outlineOffset: 0 }}
      >
        <CornerMarks />
        <div
          className="absolute max-w-[min(300px,82vw)] rounded-[14px] bg-white px-3 py-2 text-slate-950 shadow-[0_16px_40px_rgba(2,6,23,0.34)]"
          data-testid="focused-part-label"
          style={labelPlacement(box)}
        >
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--ds-accent)]">
            {showCutout ? "Isolated" : showCropWindow ? "Focused" : "In view"}
          </p>
          <p className="mt-0.5 truncate text-sm font-black">{label}</p>
        </div>
      </div>

      {/* One calm callout pointing at the visible issue, when there is one */}
      {issue && anchor ? <IssuePointer anchor={anchor} text={issue.text} /> : null}
    </div>
  );
}

function IssuePointer({ anchor, text }: { anchor: VisualFocusBox; text: string }) {
  const cx = clamp01(anchor.x + anchor.width / 2);
  const cy = clamp01(anchor.y + anchor.height / 2);
  const position: CSSProperties = { left: `${cx * 100}%`, top: `${cy * 100}%` };

  return (
    <>
      <span
        aria-hidden
        className="absolute block size-3.5 rounded-full bg-white shadow-[0_0_0_4px_rgba(78,110,146,0.45)]"
        style={{ ...position, transform: "translate(-50%,-50%)" }}
      />
      <div className="absolute" style={{ ...position, transform: "translate(-50%,calc(-50% - 30px))" }}>
        <p
          className="max-w-[min(260px,68vw)] rounded-full bg-[var(--ds-accent)] px-3 py-1.5 text-center text-xs font-bold leading-snug text-white shadow-[0_14px_30px_rgba(2,6,23,0.45)]"
          data-testid="issue-callout"
        >
          {text}
        </p>
      </div>
    </>
  );
}

function CornerMarks() {
  const common = "absolute size-7 border-white";
  return (
    <>
      <span aria-hidden className={`${common} -left-1 -top-1 rounded-tl-[18px] border-l-[5px] border-t-[5px]`} />
      <span aria-hidden className={`${common} -right-1 -top-1 rounded-tr-[18px] border-r-[5px] border-t-[5px]`} />
      <span aria-hidden className={`${common} -bottom-1 -left-1 rounded-bl-[18px] border-b-[5px] border-l-[5px]`} />
      <span aria-hidden className={`${common} -bottom-1 -right-1 rounded-br-[18px] border-b-[5px] border-r-[5px]`} />
    </>
  );
}

function percentBox(box: VisualFocusBox): CSSProperties {
  return {
    left: `${clamp01(box.x) * 100}%`,
    top: `${clamp01(box.y) * 100}%`,
    width: `${clamp01(box.width) * 100}%`,
    height: `${clamp01(box.height) * 100}%`,
  };
}

function clipFor(box: VisualFocusBox) {
  const top = clamp01(box.y) * 100;
  const left = clamp01(box.x) * 100;
  const right = clamp01(1 - box.x - box.width) * 100;
  const bottom = clamp01(1 - box.y - box.height) * 100;
  return `inset(${top}% ${right}% ${bottom}% ${left}% round 16px)`;
}

function labelPlacement(box: VisualFocusBox): CSSProperties {
  const horizontal = box.x + box.width > 0.82 ? { right: 10 } : { left: 10 };
  if (box.y > 0.16) {
    return { ...horizontal, bottom: "calc(100% + 10px)" };
  }
  return { ...horizontal, top: "calc(100% + 10px)" };
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
