import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { IdentificationResult, Lookup, VisualFocusBox } from "../../types";
import { ScanSources } from "../result/ScanSources";
import ScanThumb from "../ui/ScanThumb";
import { getTrustedFocusBox } from "./scanEvidenceGeometry";

type EvidenceItem = {
  id: "identity" | "function" | "visible" | "concerns" | "next" | "sources";
  label: string;
  summary: string;
  details: string[];
  question: string;
};

type ScanEvidencePanelProps = {
  lookup: Lookup;
  onDraftQuestion: (question: string) => void;
};

export function ScanEvidencePanel({ lookup, onDraftQuestion }: ScanEvidencePanelProps) {
  const result = lookup.result;
  const items = useMemo(() => result ? buildEvidenceItems(result) : [], [result]);
  const [selectedId, setSelectedId] = useState<EvidenceItem["id"]>("identity");
  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  const trustedFocus = getTrustedFocusBox(lookup.focusBox);
  const partName = result?.partName ?? "Captured frame";
  const modelRun = result?.modelRun;

  return (
    <aside className="ds-evidence-panel" aria-label="Scan evidence workspace">
      <header className="ds-evidence-heading">
        <div>
          <p className="ds-eyebrow">PHOTO EVIDENCE</p>
          <h2>{partName}</h2>
        </div>
        <Link to={`/result/${lookup.id}`} className="ds-evidence-open">Full result</Link>
      </header>

      <div className="ds-evidence-stage" data-has-locked-target={trustedFocus ? "true" : "false"}>
        <ScanThumb alt={`Saved photo of ${partName}`} className="ds-evidence-photo" src={lookup.frame.imageBase64} />
        {trustedFocus ? (
          <button
            aria-label={`Inspect detected ${partName}`}
            aria-pressed={selected?.id === "identity"}
            className="ds-evidence-target"
            data-testid="chat-focus-target"
            onClick={() => setSelectedId("identity")}
            style={percentBox(trustedFocus)}
            type="button"
          >
            <span>{partName}</span>
          </button>
        ) : (
          <p className="ds-evidence-geometry-note">Photo context only. No locked target geometry was saved.</p>
        )}
      </div>

      {modelRun ? (
        <p className="ds-evidence-model" title={`${modelRun.provider} · ${modelRun.model}`}>
          Result: {modelRun.provider} · {modelRun.model}
        </p>
      ) : null}

      {selected ? (
        <>
          <div className="ds-evidence-index" aria-label="Scan evidence sections">
            {items.map((item, index) => (
              <button
                aria-controls="ds-evidence-detail"
                aria-pressed={item.id === selected.id}
                className="ds-evidence-index-item"
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                type="button"
              >
                <span className="ds-evidence-index-number">{String(index + 1).padStart(2, "0")}</span>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.summary}</small>
                </span>
              </button>
            ))}
          </div>

          <section className="ds-evidence-detail" id="ds-evidence-detail" aria-live="polite">
            <div className="ds-evidence-detail-heading">
              <div>
                <p className="ds-eyebrow">SELECTED DETAIL</p>
                <h3>{selected.label}</h3>
              </div>
              <button type="button" onClick={() => onDraftQuestion(selected.question)}>Ask about this</button>
            </div>
            {selected.id === "sources" && result ? (
              <ScanSources sources={result.sourceLinks} researchTerm={result.partName} title="Scan references" />
            ) : (
              <ul>
                {selected.details.map((detail, index) => <li key={`${selected.id}-${index}`}>{detail}</li>)}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </aside>
  );
}

function percentBox(box: VisualFocusBox) {
  return {
    height: `${box.height * 100}%`,
    left: `${box.x * 100}%`,
    top: `${box.y * 100}%`,
    width: `${box.width * 100}%`,
  };
}

function buildEvidenceItems(result: IdentificationResult): EvidenceItem[] {
  const visible = [...result.visibleObservations, ...result.evidenceRegions.map((region) => region.observation)];
  const confidence = result.confidenceScore === undefined
    ? `${result.confidence} confidence`
    : `${Math.round(result.confidenceScore)}% confidence`;
  return [
    {
      id: "identity",
      label: "Identity",
      summary: `${result.partName} · ${confidence}`,
      details: result.evidence.length ? result.evidence : [`DeepSpec returned ${result.partName} with ${confidence}.`],
      question: `What visual details support the ${result.partName} identification?`,
    },
    {
      id: "function",
      label: "Function",
      summary: result.whatItDoes || "Function needs confirmation",
      details: [result.whatItDoes || "The current scan did not return a confirmed function."],
      question: `What does this ${result.partName} do, and how does it interact with nearby parts?`,
    },
    {
      id: "visible",
      label: "Visible evidence",
      summary: visible.length ? `${visible.length} scan observation${visible.length === 1 ? "" : "s"}` : "No specific observation returned",
      details: visible.length ? visible : ["No specific visible observation was returned for this photo."],
      question: `Walk me through the visible evidence in this ${result.partName} photo.`,
    },
    {
      id: "concerns",
      label: "Concerns",
      summary: result.concerns.length ? `${result.concerns.length} item${result.concerns.length === 1 ? "" : "s"} to review` : "No visible concern returned",
      details: result.concerns.length ? result.concerns : ["The scan did not return a visible concern. That is not a functional safety check."],
      question: `Which visible concerns in this ${result.partName} photo matter most, and what should I verify next?`,
    },
    {
      id: "next",
      label: "Next check",
      summary: result.nextAction,
      details: [result.nextAction, ...(result.requiredNextEvidence ?? [])],
      question: `Give me a safe step-by-step plan for the next check on this ${result.partName}.`,
    },
    {
      id: "sources",
      label: "Sources",
      summary: result.sourceLinks.length ? `${result.sourceLinks.length} saved reference${result.sourceLinks.length === 1 ? "" : "s"}` : "Start a grounded search",
      details: [],
      question: `Find reliable sources that help verify this ${result.partName} result.`,
    },
  ];
}
