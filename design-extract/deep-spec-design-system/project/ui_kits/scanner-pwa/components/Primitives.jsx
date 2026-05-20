// Deep Spec — Primitive components (Buttons, Pills, Wordmark)
// All Tailwind, no external CSS required.

const { useState } = React;

function Wordmark({ size = "sm" }) {
  const sizeClass =
    size === "lg" ? "text-[22px]" :
    size === "md" ? "text-[16px]" :
                    "text-[13px]";
  return (
    <p className={`${sizeClass} font-extrabold uppercase tracking-[0.18em] text-white/92`}>
      Deep Spec
    </p>
  );
}

function Button({ className = "", variant = "primary", children, ...props }) {
  const variants = {
    primary: "bg-white text-neutral-950 shadow-[0_12px_40px_rgba(255,255,255,0.18)]",
    ghost:   "bg-white/10 text-white backdrop-blur-md active:bg-white/15",
    danger:  "border border-[#EF4444]/30 bg-[#EF4444]/10 text-[#FCA5A5]",
  };
  return (
    <button
      className={
        "min-h-12 rounded-full px-5 text-sm font-bold transition duration-200 " +
        "disabled:pointer-events-none disabled:opacity-45 " +
        variants[variant] + " " + className
      }
      {...props}
    >
      {children}
    </button>
  );
}

function GlassPill({ className = "", children }) {
  return (
    <span className={`inline-flex items-center rounded-full bg-black/35 px-3 py-2 text-xs font-extrabold text-white/82 backdrop-blur-md ${className}`}>
      {children}
    </span>
  );
}

function ConfidenceBadge({ confidence }) {
  const styles = {
    high:   "bg-[#10B981]/15 text-[#6EE7B7] border-[#10B981]/30",
    medium: "bg-[#F59E0B]/15 text-[#FCD34D] border-[#F59E0B]/30",
    low:    "bg-[#EF4444]/15 text-[#FCA5A5] border-[#EF4444]/30",
  };
  return (
    <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-extrabold capitalize ${styles[confidence]}`}>
      {confidence}
    </span>
  );
}

function EvidenceChip({ children }) {
  return (
    <span className="rounded-full border border-[#3B82F6]/24 bg-[#3B82F6]/10 px-3 py-2 text-xs font-semibold leading-5 text-[#BFDBFE]">
      {children}
    </span>
  );
}

function Eyebrow({ children, color = "white/42" }) {
  const colorMap = {
    "white/42":   "text-white/42",
    "white/62":   "text-white/62",
    "accent":     "text-[#FACC15]",
  };
  return (
    <p className={`text-xs font-extrabold uppercase tracking-[0.14em] ${colorMap[color] || colorMap["white/42"]}`}>
      {children}
    </p>
  );
}

Object.assign(window, { Wordmark, Button, GlassPill, ConfidenceBadge, EvidenceChip, Eyebrow });
