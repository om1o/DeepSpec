import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { IsolatedObject, VisualFocusBox, VisualFocusMode } from "../../types";
import type { DerivedIssue, SceneChip } from "../../lib/resultFacts";
import ScanThumb from "../ui/ScanThumb";
import { getContainedStageStyle, orderSceneObjects } from "./isolatedPartViewGeometry";

type IsolatedPartViewProps = {
  frameBase64: string;
  isolatedImageBase64?: string;
  focusBox?: VisualFocusBox;
  focusMode: VisualFocusMode;
  label: string;
  issue?: DerivedIssue | null;
  sceneChips?: SceneChip[];
  objects?: IsolatedObject[];
  variant: "scanner" | "result";
  isVisible?: boolean;
  /** Controlled multi-object focus (lifted to the parent so a detail card can react). */
  focusedObjectIndex?: number | null;
  onFocusObject?: (index: number | null) => void;
};

const DEFAULT_BOX: VisualFocusBox = { confidence: 0, height: 0.4, width: 0.68, x: 0.16, y: 0.28 };

// Light, GPU-cheap clean-up so soft / low-light captures read crisper. Not a deblur —
// it lifts contrast and brightness a touch so the part pops.
const ENHANCE = "contrast-[1.08] saturate-[1.05] brightness-[1.04]";

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
  sceneChips,
  objects,
  variant,
  isVisible = true,
  focusedObjectIndex,
  onFocusObject,
}: IsolatedPartViewProps) {
  const [failedCutoutSource, setFailedCutoutSource] = useState<string | null>(null);

  // Permanent trace: the render's own account of what it received and which tier it chose.
  // Pair this with the "scan→state" log — if state says focusMode:mask + isolatedImageBase64:yes
  // but this logs tier B/"cutoutErrored:true", the mask reached the component but the cutout <img>
  // failed to decode and silently fell back to crop (the "Focused" chip). Effect runs before the
  // early returns so hook order stays stable.
  useEffect(() => {
    if (!isVisible || !frameBase64) {
      return;
    }
    const isLens = Boolean(objects && objects.length >= 2);
    const cutout = focusMode === "mask" && Boolean(isolatedImageBase64) && failedCutoutSource !== isolatedImageBase64;
    const cropWindow = !cutout && Boolean(focusBox) && (focusMode === "crop" || focusMode === "mask");
    const tier = isLens ? "Lens (multi-object)" : cutout ? "A · Isolated cutout" : cropWindow ? "B · Focused crop" : "C · In view";
    console.info("[DeepSpec TRACE] IsolatedPartView", {
      variant,
      focusModeReceived: focusMode,
      isolatedImageBase64: isolatedImageBase64 ? `yes (~${Math.round((isolatedImageBase64.length * 0.75) / 1024)}KB)` : "no",
      cutoutErrored: Boolean(isolatedImageBase64) && failedCutoutSource === isolatedImageBase64,
      tier,
    });
  }, [variant, isVisible, frameBase64, focusMode, isolatedImageBase64, focusBox, failedCutoutSource, objects]);

  if (!isVisible || !frameBase64) {
    return null;
  }

  // Step 6: several cut-out objects → the Lens-style overview instead of one cutout.
  if (objects && objects.length >= 2) {
    return (
      <LensOverview
        frameBase64={frameBase64}
        objects={objects}
        issue={issue}
        variant={variant}
        focusedIndex={focusedObjectIndex}
        onFocusChange={onFocusObject}
      />
    );
  }

  const hasBox = Boolean(focusBox);
  const box = focusBox ?? DEFAULT_BOX;
  const showCutout = focusMode === "mask" && Boolean(isolatedImageBase64) && failedCutoutSource !== isolatedImageBase64;
  const showCropWindow = !showCutout && hasBox && (focusMode === "crop" || focusMode === "mask");
  const chips = sceneChips ?? [];
  // Busy scene: several distinct objects → only "edge out" the background a little so the
  // other items stay readable, instead of the hard single-part blur.
  const busyScene = chips.length > 0;
  const blurBackground = showCutout || showCropWindow;
  const backgroundEffect = !blurBackground
    ? ENHANCE
    : busyScene
      ? "brightness-[0.82] saturate-[0.92]"
      : "scale-105 blur-[14px] brightness-[0.55]";
  const anchor = issue?.anchor ?? null;

  const testId = variant === "scanner" ? "focused-part-overlay" : "result-focus-frame";
  const containerClass = variant === "scanner" ? "fixed inset-0 z-40" : "absolute inset-0";
  const frameAlt = variant === "scanner" ? "Reviewed scan photo" : "Captured car part";

  return (
    <ArStage
      frameBase64={frameBase64}
      ariaLabel="Isolated part view"
      containerClassName={`pointer-events-none ${containerClass}`}
      dataFocusMode={focusMode}
      testId={testId}
    >
      {/* Background: the captured frame, filling the aspect-locked stage exactly (no crop), so
          every overlay below lines up with the pixels underneath. Hard-blurred for a single part,
          gently faded for a busy scene. */}
      <ScanThumb
        alt={frameAlt}
        className={`absolute inset-0 h-full w-full object-cover ${backgroundEffect}`}
        src={frameBase64}
      />
      {blurBackground ? <div aria-hidden className={`absolute inset-0 ${busyScene ? "bg-slate-950/20" : "bg-slate-950/45"}`} /> : null}

      {/* Tier A: the true cutout, sharp, sitting where the part is */}
      {showCutout ? (
        <img
          alt={`Isolated ${label}`}
          className={`absolute object-contain drop-shadow-[0_18px_40px_rgba(2,6,23,0.55)] ${ENHANCE}`}
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
          className={`absolute inset-0 h-full w-full object-cover ${ENHANCE}`}
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

      {/* Other things in the scene (posters, tools, parts) labelled where they sit */}
      {chips.map((chip, index) => (
        <SceneChipLabel key={`${chip.object.name}-${index}`} chip={chip} />
      ))}

      {/* One calm callout pointing at the visible issue, when there is one */}
      {issue && anchor ? <IssuePointer anchor={anchor} text={issue.text} /> : null}
    </ArStage>
  );
}

/**
 * Aspect-locked AR stage. The captured frame and every overlay (cutouts, outline, labels) share
 * ONE coordinate system: a centred box whose aspect ratio matches the frame, so frame-normalized
 * percentages line up exactly with the pixels underneath. A blurred copy fills the letterbox area.
 *
 * This replaces the old object-cover-on-the-viewport background. object-cover cropped/scaled the
 * frame to the viewport aspect, but overlays were positioned in frame-normalized %, so a sharp
 * cutout landed offset from the same object in the background — the "ghosted / doubled" bug.
 *
 * Sizing is measured (ResizeObserver + the frame's natural aspect). Before measurement resolves —
 * and in jsdom, which has neither ResizeObserver nor image decoding — the stage falls back to
 * filling the container, preserving the previous behaviour so unit tests are unaffected.
 */
function ArStage({
  frameBase64,
  ariaLabel,
  containerClassName,
  dataFocusMode,
  dataLens,
  testId,
  children,
}: {
  frameBase64: string;
  ariaLabel: string;
  containerClassName: string;
  dataFocusMode: string;
  dataLens?: string;
  testId: string;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(null);
  const [frameAspect, setFrameAspect] = useState<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") {
      return;
    }
    const measure = () => setContainerSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!frameBase64 || typeof Image === "undefined") {
      return;
    }
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        setFrameAspect(image.naturalWidth / image.naturalHeight);
      }
    };
    image.src = frameBase64;
    return () => {
      image.onload = null;
    };
  }, [frameBase64]);

  return (
    <div
      ref={containerRef}
      aria-label={ariaLabel}
      className={containerClassName}
      data-focus-mode={dataFocusMode}
      data-lens={dataLens}
      data-testid={testId}
    >
      {/* Blurred, dimmed fill for the letterbox area around the aspect-locked stage. */}
      <img
        aria-hidden
        alt=""
        className="absolute inset-0 h-full w-full object-cover scale-110 blur-[24px] brightness-[0.45]"
        src={frameBase64}
      />
      <div aria-hidden className="absolute inset-0 bg-slate-950/40" />

      {/* The stage: frame + overlays, one shared coordinate space. */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="overflow-hidden" data-testid="ar-stage" style={getContainedStageStyle(containerSize, frameAspect)}>
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * Lens-style multi-object overview: a gently dimmed frame with every cut-out object glowing.
 * Tap an object to focus it (it sharpens, others fade to a faint outline); tap empty space
 * to return to the overview. Screen-anchored (no 3D), labels capped + staggered to declutter.
 */
function LensOverview({
  frameBase64,
  objects,
  issue,
  variant,
  focusedIndex: controlledFocus,
  onFocusChange,
}: {
  frameBase64: string;
  objects: IsolatedObject[];
  issue?: DerivedIssue | null;
  variant: "scanner" | "result";
  focusedIndex?: number | null;
  onFocusChange?: (index: number | null) => void;
}) {
  // Controlled when the parent supplies onFocusChange (scanner variant, which drives a detail card);
  // otherwise fall back to local state (e.g. the saved Result page).
  const controlled = typeof onFocusChange === "function";
  const [localFocus, setLocalFocus] = useState<number | null>(null);
  const focusedIndex = controlled ? (controlledFocus ?? null) : localFocus;
  const setFocused = (index: number | null) => {
    if (controlled) {
      onFocusChange?.(index);
    } else {
      setLocalFocus(index);
    }
  };

  const ordered = orderSceneObjects(objects);
  const anchor = issue?.anchor ?? null;
  const focusedObject = focusedIndex !== null ? ordered[focusedIndex] : undefined;
  const testId = variant === "scanner" ? "focused-part-overlay" : "result-focus-frame";
  const containerClass = variant === "scanner" ? "fixed inset-0 z-40" : "absolute inset-0";
  const frameAlt = variant === "scanner" ? "Reviewed scan photo" : "Captured car part";

  return (
    <ArStage
      frameBase64={frameBase64}
      ariaLabel="Isolated scene"
      containerClassName={`pointer-events-auto ${containerClass}`}
      dataFocusMode="mask"
      dataLens="multi"
      testId={testId}
    >
      {/* Background: gently dimmed (not heavy-blurred) so the other objects stay readable */}
      <ScanThumb
        alt={frameAlt}
        className="absolute inset-0 h-full w-full object-cover brightness-[0.55] saturate-[0.95]"
        src={frameBase64}
      />
      <div aria-hidden className="absolute inset-0 bg-slate-950/30" />
      <button
        type="button"
        aria-label="Show all objects"
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={() => setFocused(null)}
      />

      {ordered.map((object, index) => {
        const isFocused = focusedIndex === index;
        const isOverview = focusedIndex === null;
        const opacity = isFocused ? 1 : isOverview ? (object.primary ? 0.96 : 0.6) : 0.18;
        const pulse = object.primary && (isFocused || isOverview);
        const glow = object.primary
          ? "drop-shadow(0 0 4px rgba(0,170,255,0.85))"
          : "drop-shadow(0 0 3px rgba(255,255,255,0.6))";
        return (
          <button
            key={`${object.name}-${index}`}
            type="button"
            data-testid="lens-object"
            aria-pressed={isFocused}
            className={`absolute animate-[ds-fade-up_0.35s_ease-out_both] ${pulse ? "lens-pulse-primary" : ""}`}
            style={{ ...percentBox(object.focusBox), zIndex: isFocused ? 30 : 20, filter: pulse ? undefined : glow }}
            onClick={(event) => {
              event.stopPropagation();
              setFocused(isFocused ? null : index);
            }}
          >
            <img
              alt={`Isolated ${object.name}`}
              className={`h-full w-full object-contain transition-opacity duration-300 ${ENHANCE}`}
              src={object.isolatedImageBase64}
              style={{ opacity }}
            />
          </button>
        );
      })}

      {/* The tapped object gets the SAME treatment as the primary single-object view:
          a bright outline + corner brackets + an "Isolated" chip. */}
      {focusedObject ? (
        <div
          className="pointer-events-none absolute rounded-[18px]"
          data-testid="lens-focused-frame"
          style={{ ...percentBox(focusedObject.focusBox), outline: "2px solid rgba(0,170,255,0.92)", outlineOffset: 0, zIndex: 35 }}
        >
          <CornerMarks />
          <div
            className="absolute max-w-[min(300px,82vw)] rounded-[14px] bg-white px-3 py-2 text-slate-950 shadow-[0_16px_40px_rgba(2,6,23,0.34)]"
            data-testid="lens-focused-label"
            style={labelPlacement(focusedObject.focusBox)}
          >
            <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--ds-accent)]">Isolated</p>
            <p className="mt-0.5 truncate text-sm font-black">{focusedObject.name}</p>
          </div>
        </div>
      ) : null}

      {/* Overview labels only when nothing is focused (the focused chip above replaces them). */}
      {focusedIndex === null
        ? ordered.map((object, index) => (
            <LensLabel key={`label-${object.name}-${index}`} object={object} index={index} />
          ))
        : null}

      {issue && anchor ? <IssuePointer anchor={anchor} text={issue.text} /> : null}
    </ArStage>
  );
}

function LensLabel({ object, index }: { object: IsolatedObject; index: number }) {
  const box = object.focusBox;
  const cx = clamp01(box.x + box.width / 2);
  const above = box.y > 0.14;
  const leader = 10 + (index % 2) * 16; // stagger neighbouring labels so they don't overlap
  const anchorTop = above ? box.y : box.y + box.height;
  const label = (
    <span
      className={`block max-w-[42vw] truncate rounded-full px-2.5 py-1 text-[11px] font-bold shadow-[0_8px_22px_rgba(2,6,23,0.45)] ${object.primary ? "bg-[var(--ds-accent)] text-white" : "border border-white/25 bg-slate-950/75 text-white"}`}
    >
      {shortName(object.name)}
    </span>
  );
  const line = <span aria-hidden className="block w-px bg-white/55" style={{ height: leader }} />;

  return (
    <div
      className="pointer-events-none absolute z-40 flex flex-col items-center"
      data-testid="lens-label"
      style={{ left: `${cx * 100}%`, top: `${anchorTop * 100}%`, transform: above ? "translate(-50%,-100%)" : "translate(-50%,0)" }}
    >
      {above ? <>{label}{line}</> : <>{line}{label}</>}
    </div>
  );
}

function shortName(name: string) {
  const clean = name.trim();
  return clean.length > 26 ? `${clean.slice(0, 24).trimEnd()}…` : clean;
}

function SceneChipLabel({ chip }: { chip: SceneChip }) {
  const cx = clamp01(chip.box.x + chip.box.width / 2);
  const cy = clamp01(chip.box.y + chip.box.height / 2);
  return (
    <div
      className="absolute"
      data-testid="scene-chip"
      style={{ left: `${cx * 100}%`, top: `${cy * 100}%`, transform: "translate(-50%,-50%)" }}
    >
      <span className="inline-block max-w-[44vw] truncate rounded-full border border-white/30 bg-slate-950/70 px-2.5 py-1 text-[11px] font-bold text-white shadow-[0_8px_22px_rgba(2,6,23,0.45)] backdrop-blur-sm">
        {chip.object.name}
      </span>
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
