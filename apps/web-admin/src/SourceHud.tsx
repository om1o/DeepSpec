type Citation = {
  source_type: string;
  document_id: string;
  page: number;
  excerpt: string;
  excerpt_hash: string;
  url_archived?: string | null;
};

export function SourceHud(props: {
  citations: Citation[];
}) {
  const { citations } = props;

  return (
    <section style={{ marginTop: 18 }}>
      <h3 style={{ margin: "0 0 10px", letterSpacing: 0.3 }}>Source HUD</h3>
      <p style={{ marginTop: 0, color: "#5e6470", fontSize: 13 }}>
        Every excerpt below is anchored to an archived manual chunk with a stable hash for audit replay.
      </p>

      <div style={{ display: "grid", gap: 10 }}>
        {citations.length === 0 ? (
          <div style={{ padding: 12, border: "1px dashed #c9ced6", borderRadius: 10 }}>No citations returned.</div>
        ) : (
          citations.map((c, idx) => (
            <details
              key={`${c.excerpt_hash}-${idx}`}
              style={{
                border: "1px solid #dfe3ea",
                borderRadius: 12,
                padding: "10px 12px",
                background: "#fafbff",
              }}
            >
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                [{idx + 1}] {c.source_type} · doc {c.document_id.slice(0, 8)}… · page {c.page}
              </summary>
              <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.45 }}>
                <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}>
                  {c.excerpt_hash}
                </div>
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    margin: "10px 0 0",
                    padding: 10,
                    background: "#fff",
                    border: "1px solid #eef1f6",
                    borderRadius: 10,
                  }}
                >
                  {c.excerpt}
                </pre>
                {c.url_archived ? (
                  <div style={{ marginTop: 8 }}>
                    Archived URL:{" "}
                    <a href={c.url_archived} target="_blank" rel="noreferrer">
                      {c.url_archived}
                    </a>
                  </div>
                ) : null}
              </div>
            </details>
          ))
        )}
      </div>
    </section>
  );
}
