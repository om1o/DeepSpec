// Deep Spec — Card primitives

function PrimaryCard({ className = "", children }) {
  return (
    <section className={`rounded-[24px] border border-white/10 bg-[#171717] p-5 ${className}`}>
      {children}
    </section>
  );
}

function WarningCard({ children, tone = "warn" }) {
  const tones = {
    warn:   "border-[#F59E0B]/30 bg-[#F59E0B]/10",
    danger: "border-[#EF4444]/30 bg-[#EF4444]/10",
  };
  return (
    <section className={`rounded-[24px] border p-5 ${tones[tone]}`}>{children}</section>
  );
}

function NestedRow({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-white/42">{label}</p>
      <p className="mt-1 text-sm leading-6 text-white/84">{value}</p>
    </div>
  );
}

function TrustReviewCard({ status, description, photoQuality, retakeGuidance, tone = "ok" }) {
  const toneBorder = {
    ok:     "border-[#10B981]/25",
    warn:   "border-[#F59E0B]/35",
    danger: "border-[#EF4444]/30",
  }[tone];
  return (
    <section className={`rounded-[24px] border bg-[#171717] p-5 ${toneBorder}`}>
      <p className="text-sm font-extrabold text-white">Trust check</p>
      <h2 className="mt-2 text-xl font-extrabold tracking-tight">{status}</h2>
      <p className="mt-3 text-sm leading-6 text-[#A1A1AA]">{description}</p>
      <div className="mt-4 grid grid-cols-1 gap-3">
        <NestedRow label="Photo quality" value={photoQuality} />
        <NestedRow label="Retake guidance" value={retakeGuidance} />
      </div>
    </section>
  );
}

function ResultSection({ title, items, emptyText }) {
  const visible = (items || []).filter(Boolean);
  return (
    <PrimaryCard>
      <h2 className="text-sm font-extrabold uppercase tracking-[0.14em] text-white/62">{title}</h2>
      {visible.length > 0 ? (
        <ul className="mt-3 space-y-2 text-sm leading-6 text-[#E5E7EB]">
          {visible.map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : (
        <p className="mt-3 text-sm leading-6 text-[#A1A1AA]">{emptyText}</p>
      )}
    </PrimaryCard>
  );
}

function EvidenceCard({ items }) {
  const visible = (items || []).filter(Boolean);
  return (
    <PrimaryCard>
      <h2 className="text-sm font-extrabold uppercase tracking-[0.14em] text-white/62">Why Deep Spec thinks this</h2>
      {visible.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {visible.map((item) => <EvidenceChip key={item}>{item}</EvidenceChip>)}
        </div>
      ) : (
        <p className="mt-3 text-sm leading-6 text-[#A1A1AA]">No visual evidence returned.</p>
      )}
    </PrimaryCard>
  );
}

Object.assign(window, { PrimaryCard, WarningCard, NestedRow, TrustReviewCard, ResultSection, EvidenceCard });
