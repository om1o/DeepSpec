import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import type Webcam from "react-webcam";
import type { CameraObjectTarget } from "../../hooks/useObjectTarget";
import { clamp, viewportBoxToNormalized, type PixelBox } from "./cropBoxGeometry";

// Console tag: fires when the CropBox component module is loaded by the scanner (regardless of
// the flag), so you can confirm in DevTools that fresh code is running.
try {
  console.info("[DeepSpec CropBox] component module loaded (cropbox-trace-1)");
} catch {
  // ignore logging failures
}

/**
 * Google Lens–style manual crop box (Stage 1: static box).
 *
 * Renders four white curved L-shaped corner brackets over a dimmed scrim, with the selected
 * region left brighter — matching Chromium's lens/overlay treatment (4px stroke, 14px radius,
 * 22px arm, 20% outside scrim, 5% inside). The box auto-appears centered, resizes from any
 * corner, and moves from its center (Pointer Events, so mouse + touch share one path). On
 * capture it hands the region — as a full-frame normalized box — to the EXISTING scan pipeline
 * via a CameraObjectTarget; segmentation (SlimSAM) is untouched.
 *
 * Device-motion parallax + haptics are Stage 2 and deliberately not here.
 */

const CORNER_STROKE = 4;
const MAX_CORNER_RADIUS = 14;
const MAX_ARM = 22;
const HANDLE_HIT = 44; // >= Lens's ~40px corner hit target
const MIN_BOX = 80; // spec min is 12px; 80 keeps corners grabbable
const DEFAULT_RATIO = 0.7;
const SPAWN_MS = 450;
const SPAWN_EASING = "cubic-bezier(0.2, 0, 0, 1.0)";

type DragMode = "move" | "tl" | "tr" | "bl" | "br";

type CropBoxProps = {
  webcamRef: RefObject<Webcam | null>;
  onCapture: (target: CameraObjectTarget) => void;
  isAnalyzing?: boolean;
};

export function CropBox({ webcamRef, onCapture, isAnalyzing = false }: CropBoxProps) {
  const { width: vw, height: vh } = useViewportSize();
  const reducedMotion = usePrefersReducedMotion();
  const [boxState, setBoxState] = useState<PixelBox>(() => defaultBox(viewportWidth(), viewportHeight()));
  const [spawned, setSpawned] = useState(false);
  const dragRef = useRef<{ mode: DragMode; startX: number; startY: number; startBox: PixelBox } | null>(null);

  // Derived so the box always fits the current viewport (resize/orientationchange) — no effect,
  // no stored-then-corrected state.
  const box = clampBoxToViewport(boxState, vw, vh);

  // Spawn animation on mount.
  useEffect(() => {
    const id = requestAnimationFrame(() => setSpawned(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Console tag: fires only when the overlay actually mounts (flag on AND camera ready). If you
  // see the flag log but NOT this one, the camera wasn't "ready" when the scanner rendered.
  useEffect(() => {
    console.info("[DeepSpec CropBox] overlay mounted on screen");
  }, []);

  const onPointerDown = (event: ReactPointerEvent) => {
    if (isAnalyzing) {
      return;
    }
    const mode = event.currentTarget.getAttribute("data-drag-mode") as DragMode | null;
    if (!mode) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { mode, startX: event.clientX, startY: event.clientY, startBox: box };
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    if (drag.mode === "move") {
      const left = clamp(drag.startBox.left + (event.clientX - drag.startX), 0, vw - drag.startBox.width);
      const top = clamp(drag.startBox.top + (event.clientY - drag.startY), 0, vh - drag.startBox.height);
      setBoxState({ ...drag.startBox, left, top });
      return;
    }
    setBoxState(resizeBox(drag.startBox, drag.mode, clamp(event.clientX, 0, vw), clamp(event.clientY, 0, vh), vw, vh));
  };

  const onPointerUp = (event: ReactPointerEvent) => {
    if (dragRef.current) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      dragRef.current = null;
    }
  };

  const handleCapture = useCallback(() => {
    if (isAnalyzing) {
      return;
    }
    const video = webcamRef.current?.video ?? null;
    const videoWidth = video?.videoWidth || vw;
    const videoHeight = video?.videoHeight || vh;
    const normalized = viewportBoxToNormalized(box, vw, vh, videoWidth, videoHeight);
    onCapture({
      confidence: 1,
      height: box.height,
      holdProgress: 1,
      id: `crop-${Math.round(typeof performance !== "undefined" ? performance.now() : 0)}`,
      isLocked: true,
      left: box.left,
      normalized: { x: normalized.x, y: normalized.y, width: normalized.width, height: normalized.height },
      top: box.top,
      width: box.width,
    });
  }, [box, isAnalyzing, onCapture, vw, vh, webcamRef]);

  const shortest = Math.min(box.width, box.height);
  const radius = Math.min(shortest / 3, MAX_CORNER_RADIUS);
  const arm = Math.min(shortest / 2, MAX_ARM);
  const scrim = "absolute bg-black/20";

  return (
    <div
      aria-label="Crop selection"
      className="pointer-events-none fixed inset-0 z-30"
      style={{
        opacity: spawned || reducedMotion ? 1 : 0,
        touchAction: "none",
        transition: reducedMotion ? undefined : `opacity ${SPAWN_MS}ms ${SPAWN_EASING}`,
      }}
    >
      {/* Outside scrim: 20% dark on all four sides of the box. */}
      <div aria-hidden className={scrim} style={{ left: 0, top: 0, width: vw, height: box.top }} />
      <div aria-hidden className={scrim} style={{ left: 0, top: box.top + box.height, width: vw, height: Math.max(0, vh - box.top - box.height) }} />
      <div aria-hidden className={scrim} style={{ left: 0, top: box.top, width: box.left, height: box.height }} />
      <div aria-hidden className={scrim} style={{ left: box.left + box.width, top: box.top, width: Math.max(0, vw - box.left - box.width), height: box.height }} />

      {/* Inside: the whole box is the move handle, dimmed only ~5% so it reads brighter. */}
      <div
        className="pointer-events-auto absolute cursor-move bg-black/5"
        data-drag-mode="move"
        data-testid="crop-box-move"
        style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        onPointerCancel={onPointerUp}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />

      {/* Four white curved L-shaped corner brackets. */}
      <svg
        aria-hidden
        className="pointer-events-none absolute"
        data-testid="crop-box-brackets"
        style={{ left: box.left, top: box.top, width: box.width, height: box.height, overflow: "visible", forcedColorAdjust: "none" }}
        viewBox={`0 0 ${box.width} ${box.height}`}
      >
        {cornerPaths(box.width, box.height, radius, arm).map((d, index) => (
          <path key={index} d={d} fill="none" stroke="white" strokeLinecap="round" strokeLinejoin="round" strokeWidth={CORNER_STROKE} />
        ))}
      </svg>

      {/* Corner hit targets (invisible, >= 44px). */}
      {(["tl", "tr", "bl", "br"] as const).map((mode) => (
        <div
          key={mode}
          className="pointer-events-auto absolute"
          data-testid={`crop-box-handle-${mode}`}
          style={{
            left: (mode === "tl" || mode === "bl" ? box.left : box.left + box.width) - HANDLE_HIT / 2,
            top: (mode === "tl" || mode === "tr" ? box.top : box.top + box.height) - HANDLE_HIT / 2,
            width: HANDLE_HIT,
            height: HANDLE_HIT,
            cursor: mode === "tl" || mode === "br" ? "nwse-resize" : "nesw-resize",
          }}
          data-drag-mode={mode}
          onPointerCancel={onPointerUp}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      ))}

      {/* Capture affordance. */}
      <div className="pointer-events-none absolute inset-x-0 flex justify-center" style={{ bottom: "max(28px, env(safe-area-inset-bottom))" }}>
        <button
          type="button"
          className="pointer-events-auto rounded-full px-6 py-3 text-sm font-black text-slate-950 shadow-[0_16px_40px_rgba(2,6,23,0.45)] disabled:opacity-50"
          data-testid="crop-box-capture"
          disabled={isAnalyzing}
          onClick={handleCapture}
          style={{ background: "white" }}
        >
          Scan this area
        </button>
      </div>
    </div>
  );
}

/** Four rounded L-bracket paths in box-local coordinates (0,0)–(w,h). */
function cornerPaths(w: number, h: number, r: number, arm: number): string[] {
  return [
    `M0 ${arm} L0 ${r} A${r} ${r} 0 0 1 ${r} 0 L${arm} 0`,
    `M${w - arm} 0 L${w - r} 0 A${r} ${r} 0 0 1 ${w} ${r} L${w} ${arm}`,
    `M${w} ${h - arm} L${w} ${h - r} A${r} ${r} 0 0 1 ${w - r} ${h} L${w - arm} ${h}`,
    `M${arm} ${h} L${r} ${h} A${r} ${r} 0 0 1 0 ${h - r} L0 ${h - arm}`,
  ];
}

function resizeBox(start: PixelBox, mode: DragMode, px: number, py: number, vw: number, vh: number): PixelBox {
  let left = start.left;
  let top = start.top;
  let right = start.left + start.width;
  let bottom = start.top + start.height;
  if (mode.includes("l")) left = Math.min(px, right - MIN_BOX);
  if (mode.includes("r")) right = Math.max(px, left + MIN_BOX);
  if (mode.includes("t")) top = Math.min(py, bottom - MIN_BOX);
  if (mode.includes("b")) bottom = Math.max(py, top + MIN_BOX);
  left = Math.max(0, left);
  top = Math.max(0, top);
  right = Math.min(vw, right);
  bottom = Math.min(vh, bottom);
  return { left, top, width: Math.max(MIN_BOX, right - left), height: Math.max(MIN_BOX, bottom - top) };
}

function defaultBox(vw: number, vh: number): PixelBox {
  const shortest = Math.min(vw, vh);
  const size = clamp(shortest * DEFAULT_RATIO, MIN_BOX, shortest * 0.9);
  return { left: (vw - size) / 2, top: (vh - size) / 2, width: size, height: size };
}

function clampBoxToViewport(box: PixelBox, vw: number, vh: number): PixelBox {
  const width = Math.min(box.width, vw);
  const height = Math.min(box.height, vh);
  return {
    width,
    height,
    left: clamp(box.left, 0, vw - width),
    top: clamp(box.top, 0, vh - height),
  };
}

function viewportWidth(): number {
  return typeof window === "undefined" ? 390 : window.innerWidth;
}

function viewportHeight(): number {
  return typeof window === "undefined" ? 844 : window.innerHeight;
}

function useViewportSize() {
  const [size, setSize] = useState(() => ({ width: viewportWidth(), height: viewportHeight() }));
  useEffect(() => {
    const onChange = () => setSize({ width: viewportWidth(), height: viewportHeight() });
    window.addEventListener("resize", onChange);
    window.addEventListener("orientationchange", onChange);
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("orientationchange", onChange);
    };
  }, []);
  return size;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
