import { useEffect, useMemo, useState } from "react";
import { SourceHud } from "./SourceHud";

type DocumentSummary = {
  id: string;
  title: string;
  storage_key: string;
  source_url: string | null;
  content_sha256: string;
};

type FusionPayload = Record<string, unknown>;

export default function App() {
  const [ocrLines, setOcrLines] = useState("31100-R40-A01\nREMAN ALT\nAC DELCO");
  const [barcode, setBarcode] = useState("31100-R40-A01");
  const [blurScore, setBlurScore] = useState("0.92");

  const [scanId, setScanId] = useState<string | null>(null);
  const [fusion, setFusion] = useState<FusionPayload | null>(null);

  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [selectedDocs, setSelectedDocs] = useState<Record<string, boolean>>({});

  const [extractionId, setExtractionId] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);

  const [approvedBy, setApprovedBy] = useState("lead.tech@shop.local");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedIds = useMemo(() => Object.entries(selectedDocs).filter(([, v]) => v).map(([k]) => k), [selectedDocs]);

  async function refreshDocuments() {
    setError(null);
    const resp = await fetch("/documents");
    if (!resp.ok) throw new Error(await resp.text());
    const data = (await resp.json()) as DocumentSummary[];
    setDocs(data);
  }

  useEffect(() => {
    refreshDocuments().catch((e) => setError(String(e)));
  }, []);

  async function createScan() {
    setBusy("scan");
    setError(null);
    try {
      const fd = new FormData();
      fd.append("barcode_text", barcode);
      fd.append("ocr_lines", ocrLines);
      fd.append("blur_score", blurScore);

      const resp = await fetch("/scans", { method: "POST", body: fd });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      setScanId(data.scan_id);
      setFusion(data.fusion);
    } finally {
      setBusy(null);
    }
  }

  async function uploadPdf(file: File) {
    setBusy("upload");
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const resp = await fetch("/documents/upload", { method: "POST", body: fd });
      if (!resp.ok) throw new Error(await resp.text());
      await refreshDocuments();
    } finally {
      setBusy(null);
    }
  }

  async function runExtract() {
    if (!scanId) {
      setError("Create a scan first.");
      return;
    }
    if (selectedIds.length === 0) {
      setError("Select at least one archived manual.");
      return;
    }

    setBusy("extract");
    setError(null);
    try {
      const resp = await fetch("/extractions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scan_id: scanId, document_ids: selectedIds }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      setExtractionId(data.extraction_id);
      setResult(data.result);
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    if (!extractionId) return;
    setBusy("approve");
    setError(null);
    try {
      const resp = await fetch(`/extractions/${extractionId}/approve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved_by: approvedBy }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const refreshed = await fetch(`/extractions/${extractionId}`);
      setResult(await refreshed.json());
    } finally {
      setBusy(null);
    }
  }

  const citations = (result?.citations ?? []) as any[];

  return (
    <div style={{ fontFamily: "system-ui, Segoe UI, Roboto, Helvetica, Arial", padding: 22, maxWidth: 1040, margin: "0 auto" }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0 }}>DeepSpec Pro — Technician Console</h1>
        <p style={{ margin: "10px 0 0", color: "#5e6470", maxWidth: 820 }}>
          Human-in-the-loop workflow: OCR/barcode fusion → archived manuals → BM25-grounded excerpts → dossier export.
        </p>
      </header>

      {error ? (
        <div style={{ padding: 12, border: "1px solid #f1baba", background: "#fff5f5", borderRadius: 10, marginBottom: 14 }}>
          <strong>Error:</strong> {error}
        </div>
      ) : null}

      <section style={{ display: "grid", gap: 14 }}>
        <div style={{ border: "1px solid #e8ecf3", borderRadius: 14, padding: 14 }}>
          <h2 style={{ marginTop: 0 }}>1) OCR Shield / fusion</h2>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, color: "#5e6470" }}>OCR lines (newline separated)</span>
            <textarea value={ocrLines} onChange={(e) => setOcrLines(e.target.value)} rows={5} style={{ width: "100%" }} />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 13, color: "#5e6470" }}>Barcode text</span>
              <input value={barcode} onChange={(e) => setBarcode(e.target.value)} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 13, color: "#5e6470" }}>Blur score (0 blurry … 1 sharp)</span>
              <input value={blurScore} onChange={(e) => setBlurScore(e.target.value)} />
            </label>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
            <button disabled={busy !== null} onClick={() => createScan()}>
              {busy === "scan" ? "Creating…" : "Create scan"}
            </button>
            {scanId ? (
              <span style={{ fontSize: 13, color: "#334" }}>
                Scan ID: <span style={{ fontFamily: "ui-monospace, monospace" }}>{scanId}</span>
              </span>
            ) : null}
          </div>

          {fusion?.conflicts ? (
            <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: "1px solid #ffe3bf", background: "#fffaf3" }}>
              <strong>Fusion conflicts:</strong>
              <pre style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>{JSON.stringify(fusion.conflicts, null, 2)}</pre>
            </div>
          ) : null}
        </div>

        <div style={{ border: "1px solid #e8ecf3", borderRadius: 14, padding: 14 }}>
          <h2 style={{ marginTop: 0 }}>2) Archive manuals</h2>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "#5e6470" }}>Upload PDF</span>
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadPdf(f).catch((err) => setError(String(err)));
                }}
              />
            </label>
            <button disabled={busy !== null} onClick={() => refreshDocuments().catch((err) => setError(String(err)))}>
              Refresh list
            </button>
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            {docs.map((d) => (
              <label key={d.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: 10, border: "1px solid #eef1f6", borderRadius: 12 }}>
                <input
                  type="checkbox"
                  checked={Boolean(selectedDocs[d.id])}
                  onChange={(e) => setSelectedDocs((prev) => ({ ...prev, [d.id]: e.target.checked }))}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 650 }}>{d.title}</div>
                  <div style={{ fontSize: 12, color: "#5e6470", fontFamily: "ui-monospace, monospace" }}>{d.id}</div>
                  {d.source_url ? (
                    <div style={{ fontSize: 12, marginTop: 6 }}>
                      Source:{" "}
                      <a href={d.source_url} target="_blank" rel="noreferrer">
                        {d.source_url}
                      </a>
                    </div>
                  ) : null}
                </div>
              </label>
            ))}
          </div>
        </div>

        <div style={{ border: "1px solid #e8ecf3", borderRadius: 14, padding: 14 }}>
          <h2 style={{ marginTop: 0 }}>3) Grounded extraction</h2>
          <button disabled={busy !== null} onClick={() => runExtract()}>
            {busy === "extract" ? "Extracting…" : "Run extraction"}
          </button>
          {extractionId ? (
            <span style={{ marginLeft: 12, fontSize: 13 }}>
              Run ID: <span style={{ fontFamily: "ui-monospace, monospace" }}>{extractionId}</span>
            </span>
          ) : null}

          {result ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ padding: 12, borderRadius: 12, border: "1px solid #dfe7ff", background: "#f7f9ff" }}>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 13, color: "#445" }}>
                      Composite score: <strong>{result.verification?.composite_score}</strong>
                    </div>
                    <div style={{ fontSize: 13, color: "#445" }}>
                      Source verified (heuristic): <strong>{String(result.verification?.source_verified)}</strong>
                    </div>
                    <div style={{ fontSize: 13, color: "#445" }}>
                      Human review required: <strong>{String(result.risk_gate?.human_review_required)}</strong>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <input value={approvedBy} onChange={(e) => setApprovedBy(e.target.value)} placeholder="Approver identity" />
                    <button disabled={busy !== null || !extractionId} onClick={() => approve()}>
                      {busy === "approve" ? "Approving…" : "Approve (human gate)"}
                    </button>
                    <a href={`/extractions/${extractionId}/dossier.pdf`}>Download dossier PDF</a>
                  </div>
                </div>

                <div style={{ marginTop: 12, fontSize: 13, color: "#334" }}>
                  <strong>Action:</strong> {result.action_required}
                </div>

                {result.risk_gate?.reasons?.length ? (
                  <div style={{ marginTop: 12 }}>
                    <strong>Risk notes:</strong>
                    <ul style={{ margin: "8px 0 0 18px" }}>
                      {result.risk_gate.reasons.map((r: string) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div style={{ marginTop: 14 }}>
                  <h3 style={{ margin: "0 0 10px" }}>Technical snapshot</h3>
                  <pre style={{ whiteSpace: "pre-wrap", padding: 12, borderRadius: 12, background: "#fff", border: "1px solid #eef1f6" }}>
                    {JSON.stringify(
                      {
                        matched_mpn: result.verification?.matched_mpn,
                        signals: result.verification?.signals,
                        technical_data: result.technical_data,
                        physical_specs: result.physical_specs,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </div>
              </div>

              <SourceHud citations={citations} />
            </div>
          ) : null}
        </div>

        <footer style={{ color: "#7b8494", fontSize: 12, paddingBottom: 26 }}>
          Audit logs available at <code>/audit/logs</code>. API docs at <code>/docs</code> when running Uvicorn locally.
        </footer>
      </section>
    </div>
  );
}
