import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "../lib/utils";
import { listLookups } from "../services/storage";
import { useStorageRevision } from "../hooks/useStorageRevision";
import type { Lookup } from "../types";

function confidenceClass(c: "high" | "medium" | "low") {
  if (c === "high") return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
  if (c === "medium") return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  return "bg-orange-600/15 text-orange-700 dark:text-orange-400";
}

export default function Home() {
  const rev = useStorageRevision();
  const [lookups, setLookups] = useState<Lookup[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let ok = true;
    void listLookups()
      .then((rows) => {
        if (!ok) return;
        setErr(null);
        setLookups(rows);
      })
      .catch((e: unknown) => {
        console.error("[home] list lookups", e);
        if (!ok) return;
        setErr(e instanceof Error ? e.message : "Could not load lookups.");
        setLookups([]);
      });
    return () => {
      ok = false;
    };
  }, [rev]);

  return (
    <div className="flex min-h-screen flex-col px-4 pb-10 pt-6">
      <header className="mb-8 flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-ds-text">Deep Spec</h1>
        <p className="text-[15px] text-ds-muted-light dark:text-ds-muted">Know what you’re looking at.</p>
      </header>

      <Link className="mb-10 block w-full" to="/capture">
        <span className="inline-flex h-14 w-full cursor-pointer items-center justify-center rounded-lg bg-ds-primary text-[17px] font-semibold tracking-tight text-white transition-opacity hover:opacity-92 active:opacity-84">
          Identify a Part
        </span>
      </Link>

      <section>
        <h2 className="mb-4 text-[13px] font-medium uppercase tracking-wider text-ds-muted-light dark:text-ds-muted">
          Recent
        </h2>
        {err ? (
          <div className="rounded-xl border border-red-900/40 bg-red-500/10 px-4 py-3 text-[14px] text-red-950 dark:border-red-500/40 dark:text-red-100">
            {err}
          </div>
        ) : null}

        {!err && lookups === null ? (
          <div className="py-14 text-center text-[15px] text-ds-muted-light dark:text-ds-muted">Loading…</div>
        ) : null}

        {!err && lookups && lookups.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ds-border-light py-14 text-center text-[15px] text-ds-muted-light dark:border-ds-border dark:text-ds-muted">
            No lookups yet.
            <br />
            Identify your first part above.
          </div>
        ) : null}

        {!err && lookups && lookups.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {lookups.map((l) => (
              <li key={l.id}>
                <Link className="block" to={`/result/${l.id}`}>
                  <div className="flex gap-3 rounded-xl border border-ds-border-light bg-white p-3 transition-colors hover:bg-neutral-50 dark:border-ds-border dark:bg-ds-card dark:hover:bg-neutral-900/70">
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-neutral-200 dark:bg-neutral-800">
                      {l.imageBase64 ? (
                        <img alt="" src={l.imageBase64} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] text-ds-muted-light dark:text-ds-muted">
                          photo
                        </div>
                      )}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="truncate text-[16px] font-medium text-neutral-900 dark:text-ds-text">
                        {l.result.partName}
                      </div>
                      <div className="flex items-center gap-2 text-[13px] text-ds-muted-light dark:text-ds-muted">
                        <time dateTime={l.createdAt}>{new Date(l.createdAt).toLocaleString()}</time>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize",
                            confidenceClass(l.result.confidence),
                          )}
                        >
                          {l.result.confidence}
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
