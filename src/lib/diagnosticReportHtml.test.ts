import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DiagnosticAssociation, DiagnosticDocument } from "../types/diagnosticReport";
import { DEFAULT_INSPECTION_REPORT_OPTIONS, type InspectionReportOptions, type InspectionReportSnapshot } from "../types/inspectionReport";
import { buildDiagnosticReportSection } from "./diagnosticReportHtml";
import { buildInspectionReportHtml } from "./inspectionReportHtml";
import { diagnosticEntryIds, diagnosticSourceText, parseDiagnosticText } from "./diagnosticReport";

const WHEN = "2026-11-05T12:00:00Z";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// Synthetic source, with private header fields and intentionally repeated readings.
const SOURCE = ["Thursday,05,November,2026,12:00:00", "VCDS -- Synthetic test", "VCDS Version: 22.4.0.1", "VIN: PRIVATE_HEADER_VIN", "License Plate: PRIVATE_PLATE", "Chassis Type: TEST", "Scan: 01 03",
  "01-Engine -- Status: Malfunction 0010", "03-Brakes -- Status: OK 0000", "Address 01: Engine", "1 Fault Found:", "12345 - Example <script> problem", " P0123 00 [001] - Intermittent", "Freeze Frame:", " Voltage: 12.00 V", " Voltage: 11.90 V", " Temperature: 25°C", "Address 03: Brakes", "No fault code found.", "End----------------------------", ""].join("\r\n");
function document(source = SOURCE): DiagnosticDocument {
  const bytes = Buffer.from(source);
  return { version: 1, id: id(1), lookupId: "scan", importedAt: WHEN, fileName: "PRIVATE_FILENAME.txt", mime: "text/plain", byteLength: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"), encoding: "utf-8", sourceBase64: bytes.toString("base64") };
}
function association(doc: DiagnosticDocument, n = 2): DiagnosticAssociation {
  return { version: 1, id: id(n), lookupId: "scan", documentId: doc.id, sourceSha256: doc.sha256, recordedAt: WHEN, subject: "Engine evidence", entryIds: ["fault-12", "reading-16"],
    photos: [{ lookupId: "scan", photoId: "photo-1", photoLabel: "overview", photoAddedAt: WHEN, scanSavedAt: WHEN, sha256: "a".repeat(64), width: 40, height: 30, observedOn: null,
      vehicleContext: { model: "Supplied model", vin: "1HGBH41JXMN109186" } }], vehicleRelationship: "unconfirmed", basis: "", notes: "Human note <img src=x onerror=alert(1)>" };
}
function snapshot(doc = document()): InspectionReportSnapshot {
  return { version: 1, rootLookupId: "scan", createdAt: WHEN, map: null, scans: [], missing: [], embeddedBytes: 0,
    diagnosticLogs: [{ lookupId: "scan", bundle: { documents: [doc], associations: [association(doc)] }, parsed: [{ id: doc.id, report: parseDiagnosticText(diagnosticSourceText(doc)) }], cloudChecked: false }],
    diagnosticEvidence: [{ lookupId: "scan", recordId: id(2), photoId: "photo-1", status: "unchanged" }] };
}
function render(value = snapshot(), options: InspectionReportOptions = DEFAULT_INSPECTION_REPORT_OPTIONS): Document {
  return new DOMParser().parseFromString(`<div id="actual-photo"></div>${buildDiagnosticReportSection(value, options, () => '<a href="#actual-photo">photo-1</a>')}`, "text/html");
}

describe("diagnostic evidence in mechanic handoff", () => {
  it("retains ordered repeated readings, raw code status and line-based links without exposing originals by default", () => {
    const doc = render();
    expect(doc.body.textContent).toContain("12.00 V"); expect(doc.body.textContent).toContain("11.90 V");
    expect(doc.body.textContent).toContain("25°C"); expect(doc.body.textContent).toContain("Intermittent");
    expect(doc.body.textContent).toContain("Source line 16"); expect(doc.body.textContent).toContain("does not establish");
    expect(doc.body.textContent).toContain("not proof of mechanical condition");
    expect(doc.querySelectorAll(".diagnostic-controller")).toHaveLength(2);
    expect(doc.querySelectorAll(".diagnostic-fault")).toHaveLength(1);
    for (const link of doc.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) expect(doc.querySelector(link.getAttribute("href")!)).not.toBeNull();
    for (const hidden of ["PRIVATE_HEADER_VIN", "PRIVATE_PLATE", "PRIVATE_FILENAME", "1HGBH41JXMN109186"]) expect(doc.body.textContent).not.toContain(hidden);
    expect(doc.querySelectorAll("a[download]")).toHaveLength(0);
    expect(doc.querySelectorAll("script,img,iframe,object")).toHaveLength(0);
    expect(doc.body.textContent).toContain("Human note <img src=x onerror=alert(1)>");
  });

  it("includes dedicated VIN fields only when selected, without including original headers or filename", () => {
    const doc = render(snapshot(), { includeVin: true, includePrivateNotes: false });
    expect(doc.body.textContent).toContain("PRIVATE_HEADER_VIN"); expect(doc.body.textContent).toContain("1HGBH41JXMN109186");
    expect(doc.body.textContent).not.toContain("PRIVATE_PLATE"); expect(doc.body.textContent).not.toContain("PRIVATE_FILENAME");
    expect(doc.querySelectorAll("a[download]")).toHaveLength(0);
  });

  it("exports opt-in unchanged Windows-1252 bytes and warns about identifiers independently of VIN selection", () => {
    const bytes = Buffer.from(SOURCE, "latin1");
    const original = { ...document(), encoding: "windows-1252" as const, byteLength: bytes.length, sourceBase64: bytes.toString("base64"), sha256: createHash("sha256").update(bytes).digest("hex") };
    const doc = render(snapshot(original), { includeVin: false, includePrivateNotes: false, includeDiagnosticOriginals: true });
    const link = doc.querySelector<HTMLAnchorElement>("a[download]")!;
    expect(Buffer.from(link.getAttribute("href")!.split(",")[1], "base64")).toEqual(bytes);
    expect(link.download).toMatch(/\.txt$/); expect(doc.body.textContent).toContain("PRIVATE_PLATE");
    expect(doc.body.textContent).toContain("PRIVATE_FILENAME.txt"); expect(doc.body.textContent).toContain("even when saved VIN fields are excluded");
    expect(doc.querySelector("pre")!.textContent).toBe(SOURCE.replaceAll("\r\n", "\n"));
  });

  it.each(["missing_photo", "source_changed", "verification_unavailable"] as const)("retains association evidence without substituting photos when %s", (status) => {
    const value = snapshot(); value.diagnosticEvidence![0].status = status;
    const doc = render(value);
    expect(doc.querySelector('.diagnostic-photo a')).toBeNull();
    expect(doc.body.textContent).toContain("No current photo is substituted");
    expect(doc.body.textContent).toContain("a".repeat(64)); expect(doc.body.textContent).toContain("Human note");
  });

  it("does not treat missing or duplicate verification records as verified", () => {
    for (const evidence of [[], [...snapshot().diagnosticEvidence!, ...snapshot().diagnosticEvidence!]]) {
      const value = snapshot(); value.diagnosticEvidence = evidence;
      expect(render(value).querySelector('.diagnostic-photo a')).toBeNull();
    }
  });

  it("retains correction forks and links to original association and selected entries", () => {
    const value = snapshot(), first = value.diagnosticLogs![0].bundle.associations[0];
    value.diagnosticLogs![0].bundle.associations.push(...[3, 4].map((n) => ({ ...first, id: id(n), supersedesId: first.id, correctionReason: "Different interpretation", notes: `Alternative ${n}`, entryIds: [] })));
    const doc = render(value);
    expect(doc.querySelectorAll(".diagnostic-association")).toHaveLength(3); expect(doc.body.textContent).toContain("Conflicting corrections remain");
    expect(doc.body.textContent).toContain("Alternative 3"); expect(doc.body.textContent).toContain("Alternative 4");
    for (const link of doc.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) expect(doc.querySelector(link.getAttribute("href")!)).not.toBeNull();
  });

  it("refuses mismatched derived data, absent selected lines and duplicate histories", () => {
    const changed = snapshot(); changed.diagnosticLogs![0].parsed[0].report.controllers[0].faults[0].description = "Fabricated finding";
    expect(() => render(changed)).toThrow("inconsistent");
    const absent = snapshot(); absent.diagnosticLogs![0].bundle.associations[0].entryIds = ["reading-19999"];
    expect(() => render(absent)).toThrow("inconsistent");
    const duplicate = snapshot(); duplicate.diagnosticLogs!.push(duplicate.diagnosticLogs![0]);
    expect(() => render(duplicate)).toThrow("inconsistent");
  });

  it("retains unrecognized and incomplete reports without suggesting they contain no faults", () => {
    for (const source of ["Unsupported synthetic scanner report", SOURCE.replace("End----------------------------", "")]) {
      const value = snapshot(document(source)); value.diagnosticLogs![0].bundle.associations[0].entryIds = [];
      const doc = render(value); expect(doc.body.textContent).toContain("Parsing limitations");
      expect(doc.body.textContent).toContain(source.startsWith("Unsupported") ? "Unrecognized format" : "end marker is missing");
    }
  });

  it("integrates retained evidence for unavailable scans into the complete static report", () => {
    const value = snapshot(); value.diagnosticEvidence = [];
    const doc = new DOMParser().parseFromString(buildInspectionReportHtml(value), "text/html");
    expect(doc.querySelector("#diagnostic-reports .diagnostic-fault")).not.toBeNull();
    expect(doc.querySelector("meta[http-equiv='Content-Security-Policy']")!.getAttribute("content")).toContain("default-src 'none'");
    expect(doc.querySelectorAll("script,a[href^='http'],img[src^='http']")).toHaveLength(0);
    expect(diagnosticEntryIds(value.diagnosticLogs![0].parsed[0].report)).toContain("reading-16");
  });
});
