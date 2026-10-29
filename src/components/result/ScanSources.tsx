import type { SourceLink } from "../../types";

type ScanSourcesProps = {
  sources: SourceLink[];
  researchTerm?: string;
  variant?: "scanner" | "result";
  title?: string;
};

/** Links returned with this scan, kept distinct from external searches. */
export function ScanSources({ sources, researchTerm, variant = "result", title = "Research & sources" }: ScanSourcesProps) {
  const seen = new Set<string>();
  const links = sources.flatMap((source) => {
    try {
      const url = new URL(source.url);
      if (url.protocol !== "https:" || url.username || url.password || seen.has(url.href)) return [];
      seen.add(url.href);
      const video = url.hostname === "youtu.be" || url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com");
      return [{ ...source, url: url.href, host: url.hostname.replace(/^www\./, ""), kind: video ? source.sourceType === "search" || url.pathname === "/results" ? "Video search" : "Video reference" : source.sourceType === "search" ? "Search" : source.sourceType === "dataset" ? "Dataset" : source.sourceType === "safety" ? "Safety reference" : "Reference" }];
    } catch {
      return [];
    }
  });
  if (!links.length && !researchTerm?.trim()) return null;
  const dark = variant === "scanner";
  const query = encodeURIComponent(researchTerm?.trim() ?? "");
  const card = dark ? "border-white/12 bg-white/5 text-white/90" : "border-[var(--ds-border)] bg-[var(--ds-surface)] text-[var(--ds-fg-2)]";

  return (
    <section aria-label={title} className={`mt-4 border-t pt-4 ${dark ? "border-white/12" : "border-[var(--ds-border)]"}`}>
      <h3 className={`text-xs font-extrabold uppercase tracking-[0.12em] ${dark ? "text-white/60" : "text-[var(--ds-fg-3)]"}`}>{title}</h3>
      <div className="mt-3 grid gap-2">
        {links.map((source) => (
          <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" className={`min-w-0 rounded-2xl border px-3 py-3 transition-colors hover:border-[#86b2c0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#86b2c0] ${card}`}>
            <span className="block text-[10px] font-bold uppercase tracking-[0.12em] opacity-60">{source.kind} · {source.host}</span>
            <span className="mt-1 block break-words text-sm font-bold leading-5">{source.label}</span>
          </a>
        ))}
      </div>
      {researchTerm?.trim() ? (
        <div className="mt-3">
          <p className={`text-[11px] font-semibold ${dark ? "text-white/50" : "text-[var(--ds-fg-3)]"}`}>Continue research</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <a href={`https://www.google.com/search?q=${query}`} target="_blank" rel="noopener noreferrer" className={`flex items-center justify-center gap-1.5 rounded-full border px-3 py-2.5 text-center text-xs font-bold ${card}`}>Search the web <ExternalArrow /></a>
            <a href={`https://www.youtube.com/results?search_query=${query}`} target="_blank" rel="noopener noreferrer" className={`flex items-center justify-center gap-1.5 rounded-full border px-3 py-2.5 text-center text-xs font-bold ${card}`}>Search YouTube <ExternalArrow /></a>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default ScanSources;

function ExternalArrow() {
  return <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 9 9 3M3 3h6v6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
