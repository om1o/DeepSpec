import type { CSSProperties } from "react";

export type FocusedPartTarget = {
  confidence: number;
  height: number;
  width: number;
  x: number;
  y: number;
};

type FocusedPartOverlayProps = {
  label: string;
  mode: "mask" | "crop" | "full_frame";
  target: FocusedPartTarget | null;
};

export function FocusedPartOverlay({ label, mode, target }: FocusedPartOverlayProps) {
  const box = targetToBox(target ?? getDefaultTarget());
  const labelStyle = getLabelStyle(box);

  return (
    <div
      aria-label="Focused item overlay"
      className="pointer-events-none fixed inset-0 z-40"
      data-focus-mode={mode}
      data-testid="focused-part-overlay"
    >
      <BlurPanel style={{ height: box.top, left: 0, top: 0, width: "100%" }} />
      <BlurPanel style={{ height: box.height, left: 0, top: box.top, width: box.left }} />
      <BlurPanel style={{ height: box.height, left: box.left + box.width, right: 0, top: box.top }} />
      <BlurPanel style={{ bottom: 0, left: 0, top: box.top + box.height, width: "100%" }} />

      <div
        className="absolute rounded-[18px]"
        data-testid="focused-part-window"
        style={{
          height: box.height,
          left: box.left,
          outline: "2px solid rgba(255,255,255,0.92)",
          outlineOffset: 0,
          top: box.top,
          width: box.width,
        }}
      >
        <CornerMarks />
        <div
          className="absolute max-w-[min(300px,82vw)] rounded-[14px] bg-white px-3 py-2 text-slate-950 shadow-[0_16px_40px_rgba(2,6,23,0.34)]"
          data-testid="focused-part-label"
          style={labelStyle}
        >
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-[var(--ds-accent)]">
            Item view
          </p>
          <p className="mt-0.5 truncate text-sm font-black">{label}</p>
        </div>
      </div>
    </div>
  );
}

function BlurPanel({ style }: { style: CSSProperties }) {
  return (
    <div
      aria-hidden
      className="absolute"
      data-testid="focused-part-blur"
      style={{
        ...style,
        backdropFilter: "blur(12px)",
        background: "rgba(2,6,23,0.58)",
      }}
    />
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

function targetToBox(target: FocusedPartTarget) {
  const viewportWidth = Math.max(1, window.innerWidth);
  const viewportHeight = Math.max(1, window.innerHeight);
  const padX = Math.max(14, target.width * 0.08);
  const padY = Math.max(14, target.height * 0.08);
  const left = clamp(target.x - padX, 10, viewportWidth - 32);
  const top = clamp(target.y - padY, 74, viewportHeight - 42);
  const right = clamp(target.x + target.width + padX, left + 32, viewportWidth - 10);
  const bottom = clamp(target.y + target.height + padY, top + 32, viewportHeight - 108);

  return {
    height: bottom - top,
    left,
    top,
    width: right - left,
  };
}

function getDefaultTarget(): FocusedPartTarget {
  const viewportWidth = Math.max(1, window.innerWidth);
  const viewportHeight = Math.max(1, window.innerHeight);
  const width = Math.min(viewportWidth * 0.68, 420);
  const height = Math.min(viewportHeight * 0.38, 320);
  return {
    confidence: 0,
    height,
    width,
    x: (viewportWidth - width) / 2,
    y: (viewportHeight - height) / 2,
  };
}

function getLabelStyle(box: { height: number; left: number; top: number; width: number }) {
  const viewportWidth = Math.max(1, window.innerWidth);
  const alignRight = box.left + 300 > viewportWidth - 14;
  const horizontal = alignRight ? { right: 10 } : { left: 10 };

  if (box.top > 126) {
    return { ...horizontal, bottom: "calc(100% + 10px)" };
  }

  return { ...horizontal, top: "calc(100% + 10px)" };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
