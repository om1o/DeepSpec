import { useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { VisualFocusBox } from "../../types";

/** Edits geometry in the original photo's coordinate space, never a generated mask. */
export function FocusAreaEditor({ box, onApply, onCancel, onChange }: {
  box: VisualFocusBox;
  onApply: (box: VisualFocusBox) => void;
  onCancel: () => void;
  /** Optional durable-draft observer; changing an area never saves a human record. */
  onChange?: (box: VisualFocusBox) => void;
}) {
  const [draft, setDraft] = useState(box);
  const start = useRef<{ x: number; y: number; pointerId: number; previous: VisualFocusBox } | null>(null);
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
  };
  const drag = (event: PointerEvent<HTMLDivElement>) => {
    const origin = start.current;
    const end = point(event);
    if (!origin || origin.pointerId !== event.pointerId || !end) return;
    if (Math.abs(end.x - origin.x) < 0.005 && Math.abs(end.y - origin.y) < 0.005) return;
    const x = Math.min(origin.x, end.x);
    const y = Math.min(origin.y, end.y);
    const next = boundBox({ confidence: 0, x, y, width: Math.max(0.02, Math.abs(end.x - origin.x)), height: Math.max(0.02, Math.abs(end.y - origin.y)) });
    setDraft(next); onChange?.(next);
  };
  const update = (field: "x" | "y" | "width" | "height", value: number) => {
    const next = boundBox({ ...draft, [field]: value, confidence: 0 });
    setDraft(next); onChange?.(next);
  };
  const selection = boundBox(draft);

  return <>
    <div
      aria-label="Draw selected area on the original photo"
      className="pointer-events-auto absolute inset-0 z-50 touch-none cursor-crosshair"
      data-testid="focus-area-editor"
      onPointerDown={(event) => {
        if (event.button !== 0 || start.current) return;
        const p = point(event);
        if (!p) return;
        start.current = { ...p, pointerId: event.pointerId, previous: draft };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={drag}
      onPointerUp={(event) => {
        drag(event);
        if (start.current?.pointerId === event.pointerId) start.current = null;
      }}
      onPointerCancel={() => { if (start.current) { setDraft(start.current.previous); onChange?.(start.current.previous); } start.current = null; }}
    >
      <div aria-hidden data-testid="focus-area-draft" className="pointer-events-none absolute border-2 border-cyan-300 bg-cyan-300/10"
        style={{ left: `${selection.x * 100}%`, top: `${selection.y * 100}%`, width: `${selection.width * 100}%`, height: `${selection.height * 100}%` }} />
    </div>
    <div className="pointer-events-auto absolute inset-x-2 bottom-2 z-[60] max-h-[55%] overflow-y-auto rounded-xl border border-white/25 bg-slate-950/95 p-3 text-white" aria-label="Selected area controls"
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onCancel(); } }}>
      <p className="text-xs">Drag on the photo, or adjust the edges below. This changes the selected area, not the AI answer.</p>
      <div className="mt-2 grid grid-cols-2 gap-x-3">
        {(["x", "y", "width", "height"] as const).map((field) => <label key={field} className="min-w-0 text-xs">
          {{ x: "Left", y: "Top", width: "Width", height: "Height" }[field]} {Math.round(selection[field] * 100)}%
          <input type="range" autoFocus={field === "x"} aria-label={`Selection ${field}`} min={field === "x" || field === "y" ? 0 : 2}
            max={Math.round((field === "x" ? 1 - selection.width : field === "y" ? 1 - selection.height : field === "width" ? 1 - selection.x : 1 - selection.y) * 100)}
            step="1" value={Math.round(selection[field] * 100)} onChange={(event) => update(field, Number(event.target.value) / 100)} className="block min-h-11 w-full accent-cyan-300" />
        </label>)}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => onApply({ ...selection, confidence: 0 })} className="min-h-11 rounded-lg bg-white px-3 text-sm font-bold text-slate-950">Apply area</button>
        <button type="button" onClick={onCancel} className="min-h-11 rounded-lg border border-white/30 px-3 text-sm font-bold">Cancel</button>
      </div>
    </div>
  </>;
}

function clamp(value: number) { return Math.max(0, Math.min(1, value)); }

function boundBox(box: VisualFocusBox): VisualFocusBox {
  const x = Math.min(0.98, clamp(box.x));
  const y = Math.min(0.98, clamp(box.y));
  return { ...box, x, y, width: Math.max(0.02, Math.min(1 - x, box.width)), height: Math.max(0.02, Math.min(1 - y, box.height)) };
}
