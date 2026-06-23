import type { IdentificationResult, Confidence } from "../../types";
import { buildVisualEvidenceLayer, type VisualEvidenceLayer, type VisualEvidenceMode, type VisualEvidenceTarget } from "./visualEvidenceLayer";

type VisualEvidenceOverlayProps = {
  result: IdentificationResult;
  target: VisualEvidenceTarget | null;
};

type LensBox = {
  height: number;
  left: number;
  top: number;
  width: number;
};

const MODE_LABELS: Record<VisualEvidenceMode, string> = {
  blocked: "Target",
  grounded: "Grounded",
  locking: "Targeting",
  measure: "Reference",
  needs_evidence: "Verify",
};

export function VisualEvidenceOverlay({ result, target }: VisualEvidenceOverlayProps) {
  const layer = buildVisualEvidenceLayer(result, target);
  if (!layer.target) {
    return null;
  }

  const focusTarget = getPartFocusedReviewTarget(layer.target, layer.label);
  const contextTarget = isFocusedTargetDifferent(layer.target, focusTarget)
    ? layer.target
    : getExpandedContextTarget(layer.target);
  const contextBox = targetToLensBox(contextTarget);
  const targetBox = targetToLensBox(focusTarget);
  const labelStyle = getLabelPlacement(targetBox);
  const modeTone = getModeTone(layer.mode, result.confidence);

  return (
    <div
      aria-label="Detected target overlay"
      className="pointer-events-none fixed inset-0 z-40"
      data-testid="visual-evidence-layer"
      data-visual-mode={layer.mode}
    >
      <div
        className="absolute rounded-[12px]"
        data-testid="lens-context-overlay"
        style={{
          background: "rgba(148, 163, 184, 0.026)",
          border: "1px dashed rgba(203, 213, 225, 0.42)",
          height: contextBox.height,
          left: contextBox.left,
          top: contextBox.top,
          width: contextBox.width,
        }}
      />

      <div
        className="absolute rounded-[12px]"
        data-testid="lens-part-overlay-0"
        style={{
          background: modeTone.fill,
          border: `2px solid ${modeTone.line}`,
          boxShadow: "0 0 0 1px rgba(2, 6, 23, 0.72), inset 0 0 0 1px rgba(255,255,255,0.10)",
          height: targetBox.height,
          left: targetBox.left,
          top: targetBox.top,
          width: targetBox.width,
        }}
      >
        <CornerBrackets color={modeTone.line} />
        <TargetCrosshair color={modeTone.line} />

        <div
          className="absolute flex max-w-[min(260px,78vw)] items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[11px] font-black text-white shadow-[0_10px_26px_rgba(0,0,0,0.36)]"
          style={{
            ...labelStyle,
            background: "rgba(2, 6, 23, 0.86)",
            border: `1px solid ${modeTone.line}`,
            backdropFilter: "blur(14px)",
          }}
        >
          <span data-testid="lens-primary-label" className="min-w-0 truncate">{layer.label}</span>
          <span
            className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.04em]"
            style={{ background: modeTone.softFill, color: modeTone.ink }}
          >
            {getConfidenceLabel(result.confidence)}
          </span>
        </div>

        <div
          className="absolute right-2 top-2 flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-[0.08em]"
          data-testid="visual-evidence-mode"
          style={{
            background: "rgba(2, 6, 23, 0.74)",
            border: `1px solid ${modeTone.line}`,
            color: modeTone.ink,
          }}
        >
          <span className="block size-1.5 rounded-full" style={{ background: modeTone.line }} />
          {MODE_LABELS[layer.mode]}
        </div>

        <div
          aria-hidden
          className="absolute bottom-2 left-2 h-1.5 rounded-full"
          style={{
            background: `linear-gradient(90deg, ${modeTone.line}, rgba(255,255,255,0.18))`,
            width: `${Math.max(34, Math.min(96, getConfidenceWidth(result.confidence, layer.confidenceRange)))}px`,
          }}
        />

        {layer.anchors.length ? (
          <div className="absolute left-0 top-full mt-2 flex max-w-[min(340px,88vw)] flex-wrap gap-1.5">
            {layer.anchors.map((anchor, index) => (
              <span
                className="rounded-[8px] px-2.5 py-1 text-[10px] font-bold text-white shadow-[0_8px_18px_rgba(0,0,0,0.30)]"
                data-testid="lens-evidence-chip"
                key={anchor.id}
                style={{
                  background: "rgba(2, 6, 23, 0.84)",
                  border: "1px solid rgba(148, 163, 184, 0.26)",
                  marginLeft: index === 0 ? 0 : undefined,
                }}
              >
                {anchor.label}: {anchor.detail}
              </span>
            ))}
          </div>
        ) : null}

        {layer.requiredEvidence.length ? (
          <div
            className="absolute bottom-full left-0 mb-2 rounded-[8px] px-2.5 py-1.5 text-[10px] font-bold text-white shadow-[0_8px_18px_rgba(0,0,0,0.30)]"
            data-testid="visual-evidence-required"
            style={{
              background: "rgba(2, 6, 23, 0.86)",
              border: `1px solid ${modeTone.line}`,
              maxWidth: "min(300px, 82vw)",
            }}
          >
            {layer.requiredEvidence.slice(0, 2).join(" / ")}
          </div>
        ) : null}

        {layer.isFallbackEstimate ? (
          <span
            className="absolute bottom-2 right-2 rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-[0.08em] text-amber-100"
            data-testid="visual-evidence-estimate"
            style={{ background: "rgba(120, 53, 15, 0.82)", border: "1px solid rgba(251, 191, 36, 0.42)" }}
          >
            offline
          </span>
        ) : null}
      </div>
    </div>
  );
}

function CornerBrackets({ color }: { color: string }) {
  const common = {
    borderColor: color,
  };
  return (
    <>
      <span aria-hidden className="absolute left-[-2px] top-[-2px] h-5 w-5 rounded-tl-[12px] border-l-2 border-t-2" style={common} />
      <span aria-hidden className="absolute right-[-2px] top-[-2px] h-5 w-5 rounded-tr-[12px] border-r-2 border-t-2" style={common} />
      <span aria-hidden className="absolute bottom-[-2px] left-[-2px] h-5 w-5 rounded-bl-[12px] border-b-2 border-l-2" style={common} />
      <span aria-hidden className="absolute bottom-[-2px] right-[-2px] h-5 w-5 rounded-br-[12px] border-b-2 border-r-2" style={common} />
    </>
  );
}

function TargetCrosshair({ color }: { color: string }) {
  return (
    <div className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border" style={{ borderColor: color }}>
      <span className="absolute left-1/2 top-[-9px] h-2 w-px -translate-x-1/2" style={{ background: color }} />
      <span className="absolute bottom-[-9px] left-1/2 h-2 w-px -translate-x-1/2" style={{ background: color }} />
      <span className="absolute left-[-9px] top-1/2 h-px w-2 -translate-y-1/2" style={{ background: color }} />
      <span className="absolute right-[-9px] top-1/2 h-px w-2 -translate-y-1/2" style={{ background: color }} />
    </div>
  );
}

function getPartFocusedReviewTarget(target: VisualEvidenceTarget, partName: string): VisualEvidenceTarget {
  const normalized = partName.toLowerCase().replace(/[-_]/g, " ");
  const focus = getPartFocusBox(normalized);

  if (!focus || target.width < 220 || target.height < 180) {
    return target;
  }

  return clampReviewTarget({
    ...target,
    height: target.height * focus.height,
    width: target.width * focus.width,
    x: target.x + target.width * focus.x,
    y: target.y + target.height * focus.y,
  });
}

function getPartFocusBox(partName: string) {
  if (/\b(front |rear |back )?bumper\b/.test(partName)) {
    return { height: 0.28, width: 0.72, x: 0.14, y: 0.64 };
  }

  if (/\bfront door\b/.test(partName)) {
    return { height: 0.44, width: 0.34, x: 0.50, y: 0.32 };
  }

  if (/\b(front and rear|rear and front|passenger side|driver side).*\bdoors?\b/.test(partName)) {
    return { height: 0.50, width: 0.58, x: 0.30, y: 0.30 };
  }

  if (/\b(rear|back) door\b/.test(partName)) {
    return { height: 0.44, width: 0.34, x: 0.36, y: 0.34 };
  }

  if (/\b(car )?doors?\b/.test(partName)) {
    return { height: 0.42, width: 0.46, x: 0.26, y: 0.34 };
  }

  if (/\bquarter panel\b/.test(partName)) {
    return { height: 0.46, width: 0.32, x: 0.64, y: 0.36 };
  }

  if (/\bfender\b/.test(partName)) {
    return { height: 0.42, width: 0.32, x: 0.16, y: 0.40 };
  }

  if (/\bhead\s*light|headlamp\b/.test(partName)) {
    return { height: 0.22, width: 0.34, x: 0.50, y: 0.36 };
  }

  if (/\btail\s*light|taillight\b/.test(partName)) {
    return { height: 0.24, width: 0.30, x: 0.66, y: 0.38 };
  }

  if (/\bgrille\b/.test(partName)) {
    return { height: 0.30, width: 0.36, x: 0.34, y: 0.42 };
  }

  if (/\bhood\b/.test(partName)) {
    return { height: 0.32, width: 0.58, x: 0.22, y: 0.20 };
  }

  if (/^engine$|\bengine assembly\b|\bengine bay\b/.test(partName)) {
    return { height: 0.54, width: 0.70, x: 0.15, y: 0.26 };
  }

  if (/\bradiator\b/.test(partName)) {
    return { height: 0.42, width: 0.56, x: 0.22, y: 0.34 };
  }

  if (/\bmirror\b/.test(partName)) {
    return { height: 0.22, width: 0.24, x: 0.18, y: 0.24 };
  }

  if (/\bbrake\b|\brotor\b|\bcaliper\b|\bdisc\b|\bdisk\b/.test(partName)) {
    return { height: 0.62, width: 0.70, x: 0.04, y: 0.18 };
  }

  if (/\b(front |rear |back )?wheel\b/.test(partName)) {
    return { height: 0.34, width: 0.28, x: 0.10, y: 0.58 };
  }

  if (/\brocker panel\b/.test(partName)) {
    return { height: 0.18, width: 0.54, x: 0.24, y: 0.70 };
  }

  return null;
}

function isFocusedTargetDifferent(target: VisualEvidenceTarget, focusTarget: VisualEvidenceTarget) {
  const widthDelta = Math.abs(target.width - focusTarget.width);
  const heightDelta = Math.abs(target.height - focusTarget.height);
  const positionDelta = Math.hypot(target.x - focusTarget.x, target.y - focusTarget.y);
  return widthDelta > 8 || heightDelta > 8 || positionDelta > 8;
}

function getExpandedContextTarget(target: VisualEvidenceTarget): VisualEvidenceTarget {
  const padX = Math.max(16, target.width * 0.14);
  const padY = Math.max(16, target.height * 0.14);
  return clampReviewTarget({
    ...target,
    height: target.height + padY * 2,
    width: target.width + padX * 2,
    x: target.x - padX,
    y: target.y - padY,
  });
}

function targetToLensBox(target: VisualEvidenceTarget): LensBox {
  const viewportWidth = Math.max(1, window.innerWidth);
  const viewportHeight = Math.max(1, window.innerHeight);
  const left = clampNumber(target.x, 0, viewportWidth - 1);
  const top = clampNumber(target.y, 0, viewportHeight - 1);
  const right = clampNumber(target.x + target.width, left + 1, viewportWidth);
  const bottom = clampNumber(target.y + target.height, top + 1, viewportHeight);

  return {
    height: bottom - top,
    left,
    top,
    width: right - left,
  };
}

function clampReviewTarget(target: VisualEvidenceTarget): VisualEvidenceTarget {
  const viewportWidth = Math.max(1, window.innerWidth);
  const viewportHeight = Math.max(1, window.innerHeight);
  const width = clampNumber(target.width, 1, viewportWidth);
  const height = clampNumber(target.height, 1, viewportHeight);

  return {
    ...target,
    confidence: clampNumber(target.confidence, 0, 1),
    height,
    width,
    x: clampNumber(target.x, 0, Math.max(0, viewportWidth - width)),
    y: clampNumber(target.y, 0, Math.max(0, viewportHeight - height)),
  };
}

function getLabelPlacement(targetBox: LensBox) {
  const viewportWidth = Math.max(1, window.innerWidth);
  const alignRight = targetBox.left + Math.min(260, viewportWidth * 0.78) > viewportWidth - 12;
  const horizontal = alignRight ? { right: 0 } : { left: 0 };

  if (targetBox.width < 180 || targetBox.height < 112) {
    return targetBox.top > 58
      ? { ...horizontal, top: -42 }
      : { ...horizontal, top: targetBox.height + 8 };
  }

  return alignRight ? { right: 8, top: 8 } : { left: 8, top: 8 };
}

function getConfidenceWidth(confidence: Confidence, range: VisualEvidenceLayer["confidenceRange"]) {
  if (range) {
    return range.low;
  }

  if (confidence === "high") return 84;
  if (confidence === "medium") return 68;
  return 44;
}

function getConfidenceLabel(confidence: Confidence) {
  if (confidence === "high") return "locked";
  if (confidence === "medium") return "solid";
  return "review";
}

function getModeTone(mode: VisualEvidenceMode, confidence: Confidence) {
  if (mode === "measure") {
    return {
      fill: "rgba(245, 158, 11, 0.055)",
      ink: "rgba(253, 230, 138, 0.96)",
      line: "rgba(245, 158, 11, 0.86)",
      softFill: "rgba(146, 64, 14, 0.72)",
    };
  }

  if (mode === "needs_evidence" || confidence === "low") {
    return {
      fill: "rgba(248, 113, 113, 0.050)",
      ink: "rgba(254, 202, 202, 0.98)",
      line: "rgba(248, 113, 113, 0.86)",
      softFill: "rgba(127, 29, 29, 0.72)",
    };
  }

  if (confidence === "medium") {
    return {
      fill: "rgba(245, 158, 11, 0.050)",
      ink: "rgba(253, 230, 138, 0.98)",
      line: "rgba(245, 158, 11, 0.82)",
      softFill: "rgba(146, 64, 14, 0.70)",
    };
  }

  return {
    fill: "rgba(20, 184, 166, 0.050)",
    ink: "rgba(153, 246, 228, 0.98)",
    line: "rgba(20, 184, 166, 0.86)",
    softFill: "rgba(19, 78, 74, 0.76)",
  };
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
