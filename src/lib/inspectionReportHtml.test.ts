import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { Lookup, PhotoRelationship, VisualFocusBox } from "../types";
import type { ComponentMapComponent } from "../types/componentMap";
import type { InspectionReportSnapshot } from "../types/inspectionReport";
import { buildInspectionReportHtml, getInspectionReportFilename, MAX_INSPECTION_REPORT_HTML_BYTES } from "./inspectionReportHtml";
import { confirmVehicleContextField } from "./vehicleContext";
import { referenceVehicleContext } from "../test/vehicleReferenceFixture";
import { DEFAULT_INSPECTION_REPORT_OPTIONS } from "../types/inspectionReport";
import type { ServiceRecord } from "../types/serviceRecord";
import type { InspectionComparison, ComparisonSide, RequestedInspectionComparison } from "../types/inspectionComparison";
import type { ObservationAreaRecord } from "../types/observationArea";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/bKkAAAAASUVORK5CYII=";
const WHEN = "2026-11-05T12:00:00Z";
const BOX: VisualFocusBox = { x: .1, y: .2, width: .3, height: .4, confidence: .8 };
const OVERVIEW_SOURCE = { sha256: createHash("sha256").update(Buffer.from(PNG.split(",")[1], "base64")).digest("hex"),
  width: 1, height: 1, photoAddedAt: "2026-11-05T12:00:00.000Z", scanSavedAt: "2026-11-05T12:00:00.000Z" };

function lookup(id = "overview"): Lookup {
  return {
    id, createdAt: WHEN, frame: { imageBase64: PNG, capturedAt: WHEN },
    photos: [{ id: `${id}-front`, label: "overview", imageBase64: PNG, capturedAt: WHEN }, { id: `${id}-label`, label: "marking", imageBase64: PNG, capturedAt: WHEN }],
    rating: null, correction: null, notes: "PRIVATE_SCAN_CANARY", scanCategory: "brakes", trainingLabel: "Brake", trainingStatus: "raw_unreviewed", chatHistory: [],
    provenance: { analysisSource: "ai_detection", captureMode: "upload", savedAt: WHEN },
    result: {
      partName: "Possible brake rotor", confidence: "low", scanCategory: "brakes", candidateMatches: [], whatItDoes: "Friction braking surface.",
      visibleObservations: ["A rough edge is visible."], evidenceRegions: [{ label: "Edge", observation: "Brown area", regionLabel: "lower edge" }],
      concerns: ["The cause is unconfirmed."], safetyTriage: "needs_professional", isSafetyCritical: true,
      nextAction: "Do not drive until the brake fault is inspected.", needsBetterPhoto: false, evidence: ["Circular friction surface"], sourceLinks: [],
      requiredNextEvidence: ["Read the minimum-thickness marking.", "Measure thickness using the specified method."],
      conditionAssessment: {
        version: 1, observations: [{ id: "o1", text: "Orange-brown material is visible.", photoIds: [`${id}-front`, `${id}-label`], regionLabel: "lower edge" }],
        possibleCauses: [{ text: "Corrosion may explain the material.", observationIds: ["o1"] }],
        unknowns: ["Remaining thickness is unknown.", "Photos do not establish braking performance."],
        nextEvidence: { kind: "measurement", request: "Have the rotor thickness measured.", purpose: "Compare remaining thickness with its service limit.", photoIds: [`${id}-front`] },
      },
      modelRun: { provider: "gemini", model: "fixture-model", promptVersion: "fixture-prompt", pipelineVersion: "fixture-pipeline", latencyMs: 1000, ocrUsed: true },
    },
  };
}

function snapshot(scans = [lookup()]): InspectionReportSnapshot {
  return { version: 1, createdAt: WHEN, rootLookupId: scans[0]?.id ?? "overview", map: null, scans, missing: [], embeddedBytes: 100 };
}

function component(index: number): ComponentMapComponent {
  return { id: `component-id-${index}`, label: `Saved component ${index + 1}`, status: "needs_view", notes: `Component note ${index + 1}`, scanGroups: [] };
}

function parsed(report: InspectionReportSnapshot, options?: Parameters<typeof buildInspectionReportHtml>[1]): Document {
  return new DOMParser().parseFromString(buildInspectionReportHtml(report, options), "text/html");
}

describe("vehicle field sources in mechanic reports", () => {
  it("exports the original query, retrieval and field attribution while keeping VIN opt-in and source text inert", () => {
    const scan = lookup();
    const context = referenceVehicleContext();
    const source = context.referenceOrigins.references[0];
    source.decode.messages = [`VIN ${context.vin} decoded. <script>alert(1)</script>`];
    scan.vehicleContext = context;
    const report = snapshot([scan]);
    const original = JSON.stringify(report);
    const doc = parsed(report);
    const heading = Array.from(doc.querySelectorAll("h4")).find(node => node.textContent === "Sources for saved vehicle fields")!;
    expect(heading).toBeDefined();
    const sourceArticle = heading.parentElement!.querySelector(`a[href="${source.sourceUrl}"]`)!.closest("article")!;
    expect(sourceArticle.textContent).toContain("year, make");
    expect(sourceArticle.textContent).toContain(source.retrievedAt);
    expect(sourceArticle.textContent).toContain(source.id);
    expect(sourceArticle.textContent).toContain("Original queried model year2003");
    expect(sourceArticle.textContent).toContain("does not independently verify the year");
    expect(sourceArticle.textContent).toContain("[VIN excluded]");
    expect(sourceArticle.textContent).toContain("<script>alert(1)</script>");
    expect(doc.querySelector("script")).toBeNull();
    expect(doc.documentElement.outerHTML).not.toContain(context.vin);
    const withVin = parsed(report, { ...DEFAULT_INSPECTION_REPORT_OPTIONS, includeVin: true });
    expect(withVin.body.textContent).toContain(`Original queried VIN${context.vin}`);
    expect(withVin.body.textContent).toContain(`VIN ${context.vin} decoded.`);
    expect(JSON.stringify(report)).toBe(original);
  });

  it("does not assert source attribution when the saved VIN no longer matches", () => {
    const scan = lookup();
    scan.vehicleContext = { ...referenceVehicleContext(), vin: "2T1BURHE6JC003971" };
    const doc = parsed(snapshot([scan]));
    expect(doc.body.textContent).toContain("No source attribution is asserted");
    expect(doc.body.textContent).not.toContain("Sources for saved vehicle fields");
    expect(doc.querySelector('a[href="https://vpic.nhtsa.dot.gov/api/"]')).toBeNull();
  });
});

function humanMeasurement(): Extract<ServiceRecord, { kind: "measurement" }> {
  return { version: 1, id: "10000000-0000-4000-8000-000000000001", lookupId: "overview", recordedAt: "2026-11-05T12:00:00.000Z", occurredOn: "2026-11-04",
    recordedBy: "PRIVATE_SERVICE_RECORDER", basis: "personally_performed", subject: "Lower bracket edge", photoIds: ["overview-front"], notes: "Calibration unknown; no service limit supplied",
    analysisAttemptId: "original-analysis", vehicleContext: { year: "2010", make: "Example", model: "Test", mileage: "123000", mileageUnit: "mi", vin: "1HGBH41JXMN109186" },
    kind: "measurement", quantity: "Thickness", reading: "2.00", unit: "mm", method: "Caliper across marked location", instrument: "Unverified caliper", conditions: "Dry", noReadingReason: "" };
}
function requestedServiceMeasurement(): Extract<ServiceRecord, { version: 2; kind: "measurement" }> {
  const first = humanMeasurement();
  return { ...first, version: 2, requestedMeasurement: { version: 1,
    guide: { version: 1, kind: "measurement", request: "Measure the historical edge <script>request</script>.", purpose: "Record the reading & method, not an inferred service limit.", photoIds: [...first.photoIds], analysisAttemptId: first.analysisAttemptId },
    analysisSha256: "d".repeat(64), references: first.photoIds.map((photoId) => ({ lookupId: first.lookupId, photoId, photoLabel: photoId.endsWith("front") ? "overview" : "marking", photoAddedAt: WHEN, scanSavedAt: WHEN,
      sha256: OVERVIEW_SOURCE.sha256, width: 1, height: 1, observedOn: null, analysisAttemptId: first.analysisAttemptId,
      vehicleContext: { vin: "PRIVATE_RECEIPT_VIN", model: "PRIVATE_RECEIPT_CONTEXT" } })) } };
}

function visualComparison(): InspectionComparison {
  const side = (lookupId: string): ComparisonSide => ({ lookupId, photoId: `${lookupId}-label`, photoLabel: "marking", photoAddedAt: WHEN, scanSavedAt: WHEN,
    sha256: "a".repeat(64), width: 1, height: 1, observedOn: null, vehicleContext: { vin: "PRIVATE_COMPARISON_VIN", model: "Historical model" } });
  return { version: 1, id: "30000000-0000-4000-8000-000000000001", lookupId: "overview", recordedAt: WHEN, subject: "Bracket comparison <original>",
    earlier: side("previous"), current: side("overview"), relationship: { sameVehicle: true, component: "same_part", basis: "Owner identified location" },
    conditions: { angle: "different", lighting: "unknown", surfaceNotes: "Wet in second photograph" }, observation: { outcome: "inconclusive", notes: "Could be lighting <script>" },
    alignment: { rotation: 15, scale: 1.2, offsetX: .1, offsetY: -.1 } };
}
function requestedReceipt(): RequestedInspectionComparison {
  const record = visualComparison();
  return { ...record, version: 2, lookupId: "followup", earlier: { ...record.earlier, lookupId: "overview", photoId: "overview-label", analysisAttemptId: "historical-analysis" }, current: { ...record.current, lookupId: "followup", photoId: "followup-label" },
    relationship: { sameVehicle: false, component: "unconfirmed", basis: "" }, observation: { outcome: "not_reviewed", notes: "" },
    requestedEvidence: { version: 1, kind: "marking", request: "Read the label <script>historical request</script>.", purpose: "Check the suffix & mounting number.", photoIds: ["overview-front", "overview-label"], analysisAttemptId: "historical-analysis" }, analysisSha256: "c".repeat(64) };
}
function withRequestedHistory(input: InspectionReportSnapshot, records = [requestedReceipt()]): InspectionReportSnapshot {
  input.requestedEvidenceHistory = { originLookupId: input.rootLookupId, source: "device", cloudSearched: false, records, complete: true, scannedBuckets: 2 };
  input.comparisonLogs = [{ lookupId: "followup", records, cloudChecked: false }];
  input.comparisonEvidence = records.flatMap((record) => (["earlier", "current"] as const).map((side) => ({ lookupId: record.lookupId, recordId: record.id, side, status: "unchanged" as const })));
  return input;
}

function areaMark(lookupId = "overview"): Extract<ObservationAreaRecord, { kind: "mark" }> {
  return { version: 1, id: "70000000-0000-4000-8000-000000000001", lookupId, recordedAt: WHEN, kind: "mark", rectangle: { x: .5, y: .2, width: .25, height: .35 }, notes: "Human note <script>not executable</script> & preserved",
    binding: { version: 1, observation: { id: "stain", text: "Historical stain <label> on the second photo.", photoIds: [`${lookupId}-label`], areas: [{ photoId: `${lookupId}-label`, rectangle: { x: .6, y: .1, width: .2, height: .3 } }] },
      analysisSha256: "c".repeat(64), analysisAttemptId: "historical-analysis",
      reference: { lookupId, photoId: `${lookupId}-label`, photoLabel: "marking", photoAddedAt: WHEN, scanSavedAt: WHEN, sha256: OVERVIEW_SOURCE.sha256, width: 1, height: 1, observedOn: null,
        analysisAttemptId: "historical-analysis", vehicleContext: { vin: "PRIVATE_AREA_RECEIPT_VIN", model: "PRIVATE_AREA_RECEIPT_CONTEXT" } } } };
}
function areaSnapshot(records: ObservationAreaRecord[] = [areaMark()]): InspectionReportSnapshot {
  const input = snapshot(); input.scans[0].focusBox = { ...BOX }; input.scans[0].focusMode = "crop";
  input.scans[0].result!.conditionAssessment = { version: 2, observations: [structuredClone(areaMark().binding.observation)], possibleCauses: [], unknowns: ["Stain source is unknown."] };
  input.observationAreaLogs = [{ lookupId: "overview", records }];
  input.observationAreaEvidence = records.map((record) => ({ lookupId: record.lookupId, recordId: record.id, photoId: record.binding.reference.photoId, status: "unchanged", analysisMatches: true }));
  return input;
}
function correctedArea(first: Extract<ObservationAreaRecord, { kind: "mark" }>, suffix = "2"): Extract<ObservationAreaRecord, { kind: "mark" }> {
  return { ...first, id: `70000000-0000-4000-8000-00000000000${suffix}`, recordedAt: `2026-11-05T1${suffix}:30:00Z`, supersedesId: first.id,
    correctionReason: "Adjusted <pointer> & retained history", rectangle: { x: .4, y: .3, width: .2, height: .3 } };
}

describe("self-contained mechanic HTML report", () => {
  it.each([
    ["chat", "Conversation only; other changes not confirmed"],
    ["inspection", "Inspection only; other changes not confirmed"],
    ["scan", "Scan record"],
  ] as const)("limits the reported cloud acknowledgment to the saved %s scope", (scope, label) => {
    const record = lookup();
    record.cloudSave = { attemptId: "saved", attemptedAt: WHEN, status: "acknowledged", scope };
    const doc = parsed(snapshot([record]));
    const field = Array.from(doc.querySelectorAll("dt")).find((element) => element.textContent === "Cloud save scope");
    expect(field?.nextElementSibling?.textContent).toBe(label);
    const status = Array.from(doc.querySelectorAll("dt")).find((element) => element.textContent === "Cloud save status");
    expect(status?.nextElementSibling?.textContent).toBe("acknowledged");
  });

  it("puts saved actions, observations, exact human readings and unresolved requests before full evidence", () => {
    const input = withRequestedHistory(snapshot([lookup(), lookup("followup")]));
    const measurement = { ...humanMeasurement(), reading: "12.40", unit: "V", quantity: "Voltage", method: "Across the marked terminals", basis: "transcribed_document" as const };
    input.serviceLogs = [{ lookupId: "overview", records: [measurement], cloudChecked: false }];
    const doc = parsed(input), overview = doc.querySelector("#review-overview")!;
    for (const value of ["Do not drive until the brake fault is inspected.", "Orange-brown material is visible.", "Remaining thickness is unknown.", "Have the rotor thickness measured.", "Compare remaining thickness with its service limit.", "12.40 V", measurement.method, measurement.instrument, "transcribed document", "2026-11-04", "not reviewed", "Collection does not establish an answered request or resolved finding"]) expect(overview.textContent).toContain(value);
    expect(overview.compareDocumentPosition(doc.querySelector("#full-evidence")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(overview.querySelector('a[href="#scan-1-service-1"]')).not.toBeNull();
    expect(overview.querySelector('a[href="#comparison-1-1"]')).not.toBeNull();
    for (const value of ["PRIVATE_SERVICE_RECORDER", "PRIVATE_SCAN_CANARY", "fixture-model", "fixture-prompt", "1HGBH41JXMN109186"]) expect(overview.textContent).not.toContain(value);
  });

  it("shows a corrected no-reading reason and withdrawal without presenting an old reading as current", () => {
    const first = humanMeasurement();
    const corrected = { ...first, id: "10000000-0000-4000-8000-000000000002", recordedAt: "2026-11-05T13:00:00Z", supersedesId: first.id, correctionReason: "Original transcription unreliable", reading: null, unit: "", method: "", noReadingReason: "Probe could not reach the contact." };
    const input = snapshot(); input.serviceLogs = [{ lookupId: "overview", records: [first, corrected], cloudChecked: true }];
    const before = parsed(input).querySelector("#review-overview")!;
    expect(before.textContent).toContain("No reading obtained — Probe could not reach the contact.");
    expect(before.textContent).not.toContain("2.00 mm");
    const retraction: ServiceRecord = { version: 1, id: "10000000-0000-4000-8000-000000000003", lookupId: "overview", recordedAt: "2026-11-05T14:00:00Z", occurredOn: null, recordedBy: first.recordedBy, basis: "personally_performed", subject: first.subject, photoIds: [], notes: "", kind: "retraction", supersedesId: corrected.id, correctionReason: "Withdraw the unverified measurement." };
    input.serviceLogs![0].records.push(retraction);
    const doc = parsed(input), overview = doc.querySelector("#review-overview")!;
    expect(overview.textContent).toContain("retracted");
    expect(overview.textContent).toContain(retraction.correctionReason);
    expect(overview.textContent).not.toContain("2.00 mm");
    expect(overview.textContent).not.toContain("Probe could not reach");
    expect(doc.querySelectorAll(".service-record")).toHaveLength(3);
    expect(doc.querySelector("#scan-1-service-1")?.textContent).toContain("2.00 mm");
  });

  it("keeps conflicting human alternatives explicit in the overview without choosing the newest reading or area", () => {
    const first = humanMeasurement(), mark = areaMark();
    const input = areaSnapshot([mark, correctedArea(mark), correctedArea(mark, "3")]);
    input.serviceLogs = [{ lookupId: "overview", cloudChecked: true, records: [first, ...["2.10", "2.20"].map((reading, index) => ({ ...first, id: `10000000-0000-4000-8000-00000000000${index + 2}`, recordedAt: `2026-11-05T1${index + 3}:00:00Z`, supersedesId: first.id, correctionReason: "Different transcription", reading }))] }];
    const doc = parsed(input), overview = doc.querySelector("#review-overview")!;
    for (const value of ["2.00 mm", "2.10 mm", "2.20 mm", "Conflicting corrections: no alternative has been selected.", "1: conflicting", "2: conflicting", "3: conflicting"]) expect(overview.textContent).toContain(value);
    expect(overview.querySelectorAll(".record-summary strong")).toHaveLength(3);
    expect([...overview.querySelectorAll(".record-summary strong")].every((item) => item.textContent === "conflicting correction")).toBe(true);
    expect(doc.querySelectorAll('.outline[aria-label^="Human area"]')).toHaveLength(0);
  });

  it("distinguishes absent and empty histories and counts gaps discovered while rendering originals", () => {
    const input = snapshot(); input.scans[0].photos![0].imageBase64 = "invalid";
    let doc = parsed(input), overview = doc.querySelector("#review-overview")!;
    expect(overview.textContent).toContain("Human measurement, repair and follow-up history was not collected.");
    expect(overview.textContent).toContain("Human area history was not collected or could not be read.");
    expect(overview.textContent).toContain("1 missing or unavailable evidence notice(s)");
    expect(doc.querySelector("#missing-evidence")?.textContent).toContain("original or cutout image unavailable");
    input.serviceLogs = [{ lookupId: "overview", records: [], cloudChecked: true }];
    input.observationAreaLogs = [{ lookupId: "overview", records: [] }];
    input.missing.push({ kind: "service_records", lookupId: "overview", message: "Human records on this device could not be read." });
    input.requestedEvidenceHistory = { originLookupId: "overview", source: "device", cloudSearched: false, records: [], complete: false, reason: "The device search reached its limit.", scannedBuckets: 0 };
    doc = parsed(input); overview = doc.querySelector("#review-overview")!;
    for (const value of ["No current human measurement, repair or follow-up entry was found in the sources read.", "cloud history checked; this does not establish a successful device read", "No human area entries were found on this device.", "2 missing or unavailable evidence notice(s)", "device search incomplete", "The device search reached its limit."]) expect(overview.textContent).toContain(value);
  });

  it.each([
    { x: 0, y: 0, width: .2, height: .2 },
    { x: .8, y: .8, width: .2, height: .2 },
    { x: .99, y: 0, width: .01, height: 1 },
  ])("keeps annotation prose outside the original for edge or narrow rectangle %j", (rectangle) => {
    const mark = { ...areaMark(), rectangle }, input = areaSnapshot([mark]), doc = parsed(input);
    const figure = doc.querySelector("#scan-1-photo-2")!, stage = figure.querySelector(".stage")!;
    for (const outline of figure.querySelectorAll<HTMLElement>(".outline")) {
      expect(outline.textContent).toBe("");
      const legend = doc.getElementById(outline.getAttribute("aria-describedby")!)!;
      expect(legend.textContent).toContain(outline.getAttribute("aria-label"));
      expect(stage.contains(legend)).toBe(false);
      expect(stage.compareDocumentPosition(legend) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const locator = legend.querySelector<HTMLElement>(".outline-position")!;
      for (const property of ["left", "top", "width", "height"] as const) expect(locator.style[property]).toBe(outline.style[property]);
    }
    expect(figure.querySelector(".outline.ai")).not.toBeNull();
    expect(figure.querySelector(".outline.human")).not.toBeNull();
    expect(stage.querySelector("img")?.getAttribute("src")).toBe(PNG);
    expect(figure.querySelector(".annotation-key")?.textContent).toContain("Dashed: AI suggestion; double: human mark");
  });

  it("collapses structural list indentation while preserving multiline saved findings and notes", () => {
    const input = areaSnapshot(); input.observationAreaLogs![0].records[0].notes = "First note line\n\nThird note line";
    input.scans[0].result!.conditionAssessment!.observations[0].text = "First finding line\nSecond finding line";
    const doc = parsed(input), style = document.createElement("style"), host = document.createElement("div");
    style.textContent = doc.querySelector("style")!.textContent;
    host.append(doc.querySelector(".photo-review-rows")!.cloneNode(true), doc.querySelector("#scan-1-observation-1")!.cloneNode(true), doc.querySelector(`#scan-1-human-area-${areaMark().id}`)!.cloneNode(true));
    document.head.append(style); document.body.append(host);
    try {
      expect(getComputedStyle(host.querySelector(".photo-review-rows li")!).whiteSpace).toBe("normal");
      const finding = host.querySelector("#scan-1-observation-1 .saved-text")!;
      expect(finding.textContent).toBe("First finding line\nSecond finding line");
      expect(getComputedStyle(finding).whiteSpace).toBe("pre-wrap");
      const note = [...host.querySelectorAll("dd")].find((element) => element.textContent === "First note line\n\nThird note line")!;
      expect(getComputedStyle(note).whiteSpace).toBe("pre-wrap");
    } finally { host.remove(); style.remove(); }
  });

  it("places independent AI and human outlines on exact photo two while the part selection stays on photo one", () => {
    const input = areaSnapshot(), first = input.observationAreaLogs![0].records[0], before = JSON.stringify(input), doc = parsed(input);
    const photoOne = doc.querySelector("#scan-1-photo-1")!, photoTwo = doc.querySelector("#scan-1-photo-2")!;
    expect(photoOne.querySelectorAll('.outline[aria-label^="Selection "]')).toHaveLength(1);
    expect(photoOne.querySelector('.outline[aria-label^="AI area"], .outline[aria-label^="Human area"]')).toBeNull();
    expect(photoTwo.querySelector('.outline[aria-label^="Selection "]')).toBeNull();
    const ai = photoTwo.querySelector<HTMLAnchorElement>('.outline[aria-label^="AI area"]')!;
    const human = photoTwo.querySelector<HTMLAnchorElement>('.outline[aria-label^="Human area"]')!;
    expect(ai.getAttribute("href")).toBe("#scan-1-observation-1");
    expect(ai.getAttribute("aria-label")).toContain("unverified");
    expect(ai.style.left).toBe("60%"); expect(ai.style.width).toBe("20%");
    expect(human.getAttribute("href")).toBe(`#scan-1-human-area-${first.id}`);
    expect(human.style.left).toBe("50%"); expect(human.style.width).toBe("25%");
    expect(doc.querySelector(ai.getAttribute("href")!)?.textContent).toContain(first.binding.observation.text);
    expect(doc.querySelector(human.getAttribute("href")!)?.textContent).toContain("embedded original bytes and saved photo context match");
    expect(doc.body.textContent).toContain("not damage boundaries, measurements or confirmed findings");
    expect(doc.body.textContent).toContain("does not include a provider-time image checksum");
    for (const figure of [photoOne, photoTwo]) expect(figure.querySelector("img")?.getAttribute("src")).toBe(PNG);
    expect(doc.querySelector("script")).toBeNull();
    expect(doc.body.textContent).toContain(first.notes);
    for (const marker of ["PRIVATE_AREA_RECEIPT_VIN", "PRIVATE_AREA_RECEIPT_CONTEXT", "PRIVATE_SCAN_CANARY"]) expect(doc.body.textContent).not.toContain(marker);
    expect(parsed(input, { includeVin: true, includePrivateNotes: true }).body.textContent).not.toContain("PRIVATE_AREA_RECEIPT_VIN");
    expect(JSON.stringify(input)).toBe(before);
  });

  it("retains superseded marks and draws only the latest correction on its cited photo", () => {
    const first = areaMark(), correction = correctedArea(first), doc = parsed(areaSnapshot([first, correction]));
    const outlines = doc.querySelectorAll('.outline[aria-label^="Human area"]');
    expect(outlines).toHaveLength(1); expect(outlines[0].getAttribute("href")).toBe(`#scan-1-human-area-${correction.id}`);
    expect(doc.querySelector(`#scan-1-human-area-${first.id} h4`)?.textContent).toContain("superseded");
    const history = doc.querySelector(`#scan-1-human-area-${correction.id}`)!;
    expect(history.textContent).toContain(correction.correctionReason);
    expect(history.querySelector(`a[href="#scan-1-human-area-${first.id}"]`)).not.toBeNull();
  });

  it.each(["retracted", "forked"] as const)("keeps %s human history without choosing an active outline or removing the AI pointer", (kind) => {
    const first = areaMark(), correction = correctedArea(first);
    const final: ObservationAreaRecord = kind === "forked" ? correctedArea(first, "3") : { version: 1, id: "70000000-0000-4000-8000-000000000003", lookupId: first.lookupId,
      recordedAt: "2026-11-05T14:00:00Z", kind: "retraction", binding: structuredClone(first.binding), notes: "Mark withdrawn", supersedesId: correction.id, correctionReason: "Do not rely on this mark" };
    const doc = parsed(areaSnapshot([first, correction, final]));
    expect(doc.querySelectorAll('.outline[aria-label^="Human area"]')).toHaveLength(0);
    expect(doc.querySelectorAll('.outline[aria-label^="AI area"]')).toHaveLength(1);
    for (const record of [first, correction, final]) expect(doc.querySelector(`#scan-1-human-area-${record.id}`)?.textContent).toContain(record.notes);
    expect(doc.querySelector(`#scan-1-human-area-${final.id} h4`)?.textContent).toContain(kind === "forked" ? "conflicting" : "retracted");
    if (kind === "forked") expect(doc.body.textContent).toContain("No active outline was chosen");
  });

  it.each(["source_changed", "missing_photo", "verification_unavailable", "absent", "duplicate", "wrong-photo", "missing-pixels", "removed-photos"] as const)("hides a human outline when the exact source proof is %s", (status) => {
    const input = areaSnapshot(), record = input.observationAreaLogs![0].records[0];
    if (status === "absent") input.observationAreaEvidence = [];
    else if (status === "duplicate") input.observationAreaEvidence!.push({ ...input.observationAreaEvidence![0] });
    else if (status === "wrong-photo") input.observationAreaEvidence![0].photoId = "overview-front";
    else if (status === "missing-pixels") input.scans[0].photos![1].imageBase64 = "";
    else if (status === "removed-photos") input.scans[0].photos = [];
    else input.observationAreaEvidence![0].status = status;
    const doc = parsed(input), history = doc.querySelector(`#scan-1-human-area-${record.id}`)!;
    expect(doc.querySelectorAll('.outline[aria-label^="Human area"]')).toHaveLength(0);
    expect(history.textContent).toContain("outline is not placed on the current photo");
    expect(history.textContent).not.toContain("embedded original bytes and saved photo context match");
    expect(history.textContent).toContain(record.binding.observation.text);
    expect(history.textContent).toContain(record.notes);
    if (status === "removed-photos") expect(doc.querySelectorAll("img")).toHaveLength(0);
  });

  it("labels an intact human pointer as historical after the AI answer changes instead of borrowing the new claim", () => {
    const input = areaSnapshot(), record = input.observationAreaLogs![0].records[0];
    input.scans[0].result!.conditionAssessment!.observations[0].text = "Current answer: a reflection, not an established leak.";
    input.observationAreaEvidence![0].analysisMatches = false;
    const doc = parsed(input), history = doc.querySelector(`#scan-1-human-area-${record.id}`)!;
    expect(doc.querySelectorAll('.outline[aria-label^="Human area"]')).toHaveLength(1);
    expect(history.textContent).toContain(record.binding.observation.text);
    expect(history.textContent).toContain("keeps its historical claim");
    expect(history.textContent).toContain("embedded original bytes and saved photo context match");
    expect(history.textContent).not.toContain("saved AI answer matches");
    expect(history.textContent).not.toContain("Current answer:");
    expect(doc.querySelector("#scan-1-observation-1")?.textContent).toContain("Current answer:");
  });

  it("exports unavailable linked-scan area history and correction anchors without substituting another scan's images or private context", () => {
    const first = areaMark("removed"), correction = correctedArea(first), input = snapshot();
    input.observationAreaLogs = [{ lookupId: "removed", records: [first, correction] }];
    input.observationAreaEvidence = [first, correction].map((record) => ({ lookupId: "removed", recordId: record.id, photoId: "removed-label", status: "missing_photo", analysisMatches: false }));
    const before = JSON.stringify(input), doc = parsed(input), history = doc.querySelector("#unavailable-area-history")!;
    expect(history.textContent).toContain("Unavailable scan: removed");
    expect(history.textContent).toContain("No outline is placed on another image");
    expect(history.textContent).toContain(first.binding.observation.text);
    expect(history.textContent).toContain("removed-label");
    expect(history.textContent).toContain(first.binding.analysisSha256);
    expect(history.textContent).toContain(first.binding.reference.sha256);
    expect(history.textContent).toContain(first.notes);
    expect(history.textContent).toContain(correction.correctionReason);
    expect(history.querySelectorAll("article")).toHaveLength(2);
    const target = history.querySelector("a")?.getAttribute("href");
    expect(target).toBe(`#unavailable-area-1-${first.id}`); expect(doc.querySelector(target!)).not.toBeNull();
    expect(history.querySelector("img, .outline, script")).toBeNull();
    expect(doc.querySelectorAll('.outline[aria-label^="Human area"]')).toHaveLength(0);
    expect(doc.body.textContent).not.toMatch(/PRIVATE_AREA_RECEIPT_VIN|PRIVATE_AREA_RECEIPT_CONTEXT/);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("renders historical requested measurements, exact readings, no-reading corrections and retractions without leaking receipt context", () => {
    const first = requestedServiceMeasurement();
    const corrected = { ...first, id: "10000000-0000-4000-8000-000000000002", supersedesId: first.id, recordedAt: "2026-11-05T13:00:00Z", correctionReason: "Cannot rely on original reading", reading: null, unit: "", method: "", noReadingReason: "The tool could not reach the marked edge." };
    const retracted: Extract<ServiceRecord, { version: 2; kind: "retraction" }> = { version: 2, kind: "retraction", id: "10000000-0000-4000-8000-000000000003", lookupId: first.lookupId,
      recordedAt: "2026-11-05T14:00:00Z", occurredOn: null, recordedBy: first.recordedBy, basis: first.basis, subject: first.subject, photoIds: first.photoIds, notes: "Retraction preserves the original request",
      analysisAttemptId: first.analysisAttemptId, supersedesId: corrected.id, correctionReason: "Request requires professional assessment", requestedMeasurement: structuredClone(first.requestedMeasurement) };
    const input = snapshot(), records = [first, corrected, retracted];
    input.serviceLogs = [{ lookupId: first.lookupId, records, cloudChecked: false }];
    input.serviceEvidence = records.flatMap((record) => record.requestedMeasurement.references.map((side) => ({ lookupId: record.lookupId, recordId: record.id, photoId: side.photoId, status: "unchanged" })));
    const before = JSON.stringify(input), doc = parsed(input), articles = [...doc.querySelectorAll('.service-record')];
    expect(articles).toHaveLength(3);
    for (const article of articles) {
      expect(article.textContent).toContain(first.requestedMeasurement.guide.request);
      expect(article.textContent).toContain(first.requestedMeasurement.guide.purpose);
      expect(article.textContent).toContain(first.requestedMeasurement.analysisSha256);
      expect(article.textContent).toContain("historical receipt data");
      expect(article.querySelector('.requested-measurement')?.textContent).toContain("embedded original bytes and saved context match this receipt");
      expect(article.querySelector('.requested-measurement a')?.getAttribute('href')).toBe('#scan-1-photo-1');
    }
    expect(articles[0].textContent).toContain("2.00 mm");
    expect(articles[1].textContent).toContain("No reading obtained");
    expect(articles[1].textContent).toContain(corrected.noReadingReason);
    expect(articles[1].textContent).not.toContain("0 mm");
    expect(articles[2].textContent).toContain("retracted");
    expect(articles[2].querySelector('a[href="#scan-1-service-2"]')).not.toBeNull();
    for (const marker of ["PRIVATE_RECEIPT_VIN", "PRIVATE_RECEIPT_CONTEXT", first.recordedBy, "PRIVATE_SCAN_CANARY"]) expect(doc.body.textContent).not.toContain(marker);
    expect(parsed(input, { includeVin: true, includePrivateNotes: true }).body.textContent).not.toContain("PRIVATE_RECEIPT_VIN");
    expect(doc.querySelector("script")).toBeNull();
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each(["source_changed", "missing_photo", "verification_unavailable", "absent", "duplicate", "missing-pixels"] as const)("does not claim a matching requested-measurement original when proof is %s", (status) => {
    const input = snapshot(), record = requestedServiceMeasurement();
    input.serviceLogs = [{ lookupId: record.lookupId, records: [record], cloudChecked: false }];
    if (status !== "absent") input.serviceEvidence = [{ lookupId: record.lookupId, recordId: record.id, photoId: record.photoIds[0], status: status === "duplicate" || status === "missing-pixels" ? "unchanged" : status }];
    if (status === "duplicate") input.serviceEvidence!.push({ ...input.serviceEvidence![0] });
    if (status === "missing-pixels") input.scans[0].photos![0].imageBase64 = "";
    const doc = parsed(input), evidence = doc.querySelector('.requested-measurement')!;
    expect(evidence.textContent).not.toContain("embedded original bytes and saved context match");
    expect(evidence.textContent).toContain("not verified as the receipt original");
    expect(evidence.querySelector('a')?.getAttribute('href')).toBe('#scan-1-photo-1');
    expect(doc.querySelector('#missing-evidence')?.textContent).toContain("Requested measurement");
    expect(doc.querySelector('.service-record')?.textContent).toContain("2.00 mm");
    if (status === "source_changed") expect(evidence.textContent).toContain("differs from this receipt");
  });

  it("does not invent a bound photo for an uncited measurement request", () => {
    const input = snapshot(), record = requestedServiceMeasurement();
    record.requestedMeasurement.guide.photoIds = []; record.requestedMeasurement.references = [];
    input.serviceLogs = [{ lookupId: record.lookupId, records: [record], cloudChecked: false }];
    const doc = parsed(input), evidence = doc.querySelector('.requested-measurement')!;
    expect(evidence.textContent).toContain("No original photos were cited");
    expect(evidence.textContent).toContain("do not retroactively become AI citations");
    expect(evidence.querySelector('a')).toBeNull();
    expect(doc.querySelector('.service-record a[href="#scan-1-photo-1"]')).not.toBeNull();
  });

  function scopedSnapshot(): InspectionReportSnapshot {
    const input = snapshot([lookup(), lookup("linked"), lookup("outside"), lookup("conflict")]);
    input.scans.forEach((scan) => { scan.vehicleContext = { vin: "PRIVATE_SCOPE_VIN", customerName: "PRIVATE_SCOPE_CUSTOMER", jobTitle: "PRIVATE_SCOPE_JOB_TITLE" }; });
    input.jobScope = { version: 1, jobId: "job-private-id", rootLookupId: "overview", jobScanIds: ["overview", "linked", "excluded", "missing", "conflict", "absent-conflict"],
      includedJobScanIds: ["overview", "linked"], excludedJobScanIds: ["excluded"], unavailableJobScanIds: ["missing"], outsideJobScanIds: ["outside"],
      conflictingJobScanIds: ["conflict", "absent-conflict"], vehicleDifferences: [{ lookupId: "linked", fields: ["vin", "model"] }] };
    return input;
  }

  it("exports selected-overview coverage with exclusions, linked conflicts and field names without private values", () => {
    const input = scopedSnapshot(), before = JSON.stringify(input), doc = parsed(input);
    const section = doc.querySelector("#job-report-scope")!;
    expect(section.textContent).toContain("not an all-job report");
    expect(section.textContent).toContain("Unavailable job scans");
    expect(section.textContent).toContain("missing");
    expect(section.textContent).toContain("conflict: Included through linked evidence; job association conflicts.");
    expect(section.textContent).toContain("absent-conflict: Not included; job association conflicts.");
    expect(section.textContent).toContain("linked: vin, model");
    expect(section.querySelector('a[href="#scan-2"]')?.textContent).toBe("linked");
    expect(section.querySelector('a[href="#scan-3"]')?.textContent).toBe("outside");
    expect(section.querySelectorAll("a")).toHaveLength(3);
    for (const text of ["PRIVATE_SCOPE_VIN", "PRIVATE_SCOPE_CUSTOMER", "PRIVATE_SCOPE_JOB_TITLE", "job-private-id"]) expect(doc.body.textContent).not.toContain(text);
    // These eight references intentionally use identical PNG bytes. The report
    // embeds a shared asset once, but every photo must retain its own figure and
    // resolve to those exact bytes through the duplicate-asset link.
    expect(doc.querySelectorAll("img")).toHaveLength(1);
    for (const [scanIndex, scan] of input.scans.entries()) for (const [photoIndex, photo] of scan.photos!.entries()) {
      const figure = doc.querySelector(`#scan-${scanIndex + 1}-photo-${photoIndex + 1}`)!;
      expect(figure).not.toBeNull();
      expect(figure.querySelector("figcaption")?.textContent).toContain(photo.id);
      const duplicateTarget = figure.querySelector<HTMLAnchorElement>('a[href^="#"]')?.getAttribute("href");
      const image = figure.querySelector("img") ?? (duplicateTarget ? doc.querySelector(`${duplicateTarget} img`) : null);
      expect(image?.getAttribute("src")).toBe(photo.imageBase64);
      const actualBytes = Buffer.from(image!.getAttribute("src")!.split(",")[1], "base64");
      const originalBytes = Buffer.from(photo.imageBase64.split(",")[1], "base64");
      expect(actualBytes).toEqual(originalBytes);
    }
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each(["wrong-root", "missing-included", "overlap", "outside-omission", "private-value", "malicious-id", "unknown-field"])("rejects inconsistent or unsafe job coverage: %s", (kind) => {
    const input = scopedSnapshot(), job = input.jobScope!;
    if (kind === "wrong-root") job.rootLookupId = "linked";
    if (kind === "missing-included") job.includedJobScanIds.push("not-collected");
    if (kind === "overlap") job.excludedJobScanIds.push("linked");
    if (kind === "outside-omission") job.outsideJobScanIds = [];
    if (kind === "private-value") job.vehicleDifferences[0].fields = ["PRIVATE_SCOPE_VIN"];
    if (kind === "malicious-id") job.jobScanIds.push('<img src=x onerror="bad()">');
    if (kind === "unknown-field") Object.assign(job, { customerName: "PRIVATE_CUSTOMER" });
    expect(() => buildInspectionReportHtml(input)).toThrow("job report scope is invalid or inconsistent");
  });

  it("leaves ordinary inspection exports without a job coverage claim", () => {
    expect(parsed(snapshot()).querySelector("#job-report-scope")).toBeNull();
  });

  function linkedSnapshot(): InspectionReportSnapshot {
    const input = snapshot(), first = component(0);
    first.notes = "Human link note <script>not executable</script>";
    first.region = { sourcePhotoId: "overview-front", box: BOX };
    first.scanGroups = [{ linkId: "bound-link", lookupId: "overview", photoIds: ["overview-front", "overview-label"],
      binding: { version: 1, photoRelationship: "independent", photos: [
        { photoId: "overview-front", label: "overview", source: { ...OVERVIEW_SOURCE } },
        { photoId: "overview-label", label: "marking", source: { ...OVERVIEW_SOURCE } },
      ] } }];
    input.map = { document: { version: 4, id: "overview", overview: { lookupId: "overview", photoId: "overview-front", source: { ...OVERVIEW_SOURCE } }, components: [first] },
      localRevision: 2, cloudRevision: null, syncedLocalRevision: 0 };
    input.mapOverviewEvidence = { status: "unchanged", message: "Verified overview." };
    input.linkedPhotoEvidence = first.scanGroups[0].photoIds.map((photoId) => ({ componentId: first.id, linkId: "bound-link", lookupId: "overview", photoId, status: "unchanged", message: "Verified photo." }));
    return input;
  }

  it("renders verified v4 linked files with historical labels/relationship separate from changed current metadata", () => {
    const input = linkedSnapshot(); input.scans[0].photoRelationship = "same_part_or_area"; input.scans[0].photos![1].label = "close_up";
    input.linkedPhotoEvidence!.forEach((row) => { row.currentMetadataChanged = true; });
    const before = JSON.stringify(input), doc = parsed(input);
    expect(doc.querySelectorAll(".outline.map")).toHaveLength(1);
    const group = doc.querySelector(".linked-photo-group")!;
    expect(group.textContent).toContain("User-reported relationship at linking");
    expect(group.textContent).toContain("Independent examples");
    expect(group.textContent).toContain("Current user-reported relationship");
    expect(group.textContent).toContain("Label at linkingmarking");
    expect(group.textContent).toContain("Current saved labelclose up");
    expect(group.textContent).toContain("scoped to Photo 1");
    expect(group.querySelectorAll(".linked-photo-evidence")).toHaveLength(2);
    expect(group.textContent?.match(/Verified linked photo/g)).toHaveLength(2);
    expect(group.querySelector('a[href="#scan-1-photo-1"]')).not.toBeNull();
    expect(group.querySelector('a[href="#scan-1-photo-2"]')).not.toBeNull();
    expect(doc.querySelector("#component-1")?.textContent).toContain("Human link note <script>not executable</script>");
    expect(doc.querySelectorAll("script")).toHaveLength(0);
    expect(doc.querySelector("#scan-1-photo-1 img")?.getAttribute("src")).toBe(PNG);
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each(["source_changed", "missing_photo", "verification_unavailable", "absent", "duplicate"] as const)("does not label a current image as historical evidence when a bound check is %s", (status) => {
    const input = linkedSnapshot();
    if (status === "absent") input.linkedPhotoEvidence!.pop();
    else if (status === "duplicate") input.linkedPhotoEvidence!.push({ ...input.linkedPhotoEvidence![1] });
    else input.linkedPhotoEvidence![1].status = status;
    const doc = parsed(input), rows = doc.querySelectorAll(".linked-photo-evidence");
    expect(rows[0].textContent).toContain("Verified linked photo");
    expect(rows[1].textContent).not.toContain("Verified linked photo");
    expect(rows[1].textContent).toContain("Current saved image reference — not verified as historical evidence");
    expect(rows[1].textContent).toContain("Label at linkingmarking");
    expect(rows[1].querySelector('a[href="#scan-1-photo-2"]')).not.toBeNull();
    expect(doc.querySelector("#missing-evidence")?.textContent).toContain("Component 1, photo group 1, photo overview-label");
    expect(doc.querySelector("#component-1")?.textContent).toContain("Human link note");
    expect(doc.querySelectorAll(".outline.map")).toHaveLength(1);
  });

  it("retains every distinct link and keeps ID-only groups explicitly unverified inside a v4 map", () => {
    const input = linkedSnapshot(), groups = input.map!.document.components[0].scanGroups;
    groups.push({ ...structuredClone(groups[0]), linkId: "second-bound-link" }, { linkId: "legacy-link", lookupId: "overview", photoIds: ["overview-label"] });
    input.linkedPhotoEvidence!.push(...input.linkedPhotoEvidence!.map((row) => ({ ...row, linkId: "second-bound-link" })),
      { ...input.linkedPhotoEvidence![1], linkId: "legacy-link" });
    const doc = parsed(input), rendered = doc.querySelectorAll(".linked-photo-group");
    expect(rendered).toHaveLength(3);
    expect(rendered[0].querySelectorAll(".linked-photo-evidence")).toHaveLength(2);
    expect(rendered[1].querySelectorAll(".linked-photo-evidence")).toHaveLength(2);
    expect(rendered[2].textContent).toContain("Legacy linked group");
    expect(rendered[2].textContent).not.toContain("Verified linked photo");
    expect(rendered[2].textContent).not.toContain("Label at linking");
  });

  it("does not invent a legacy frame photo when an explicitly empty saved photo list is linked", () => {
    const input = linkedSnapshot(); input.scans[0].photos = [];
    input.linkedPhotoEvidence!.forEach((row) => { row.status = "missing_photo"; });
    const doc = parsed(input);
    expect(doc.querySelectorAll("#scan-1 figure img")).toHaveLength(0);
    expect(doc.querySelector("#scan-1-photo-1")).toBeNull();
    expect(doc.querySelector(".linked-photo-group")?.textContent).not.toContain("Verified linked photo");
    expect(doc.querySelectorAll(".linked-photo-evidence")).toHaveLength(2);
    expect(doc.querySelector("#component-1")?.textContent).toContain("Human link note");
  });
  it.each([
    ["source_changed", "differs from the map's recorded source"],
    ["missing_photo", "bound overview image is missing"],
    ["verification_unavailable", "Verification of the embedded overview is unavailable"],
    [undefined, "Verification of the embedded overview is unavailable"],
  ] as const)("hides v3 map overlays for %s while preserving human records, image bytes and links", (status, warning) => {
    const input = snapshot(), componentRecord = { ...component(0), region: { sourcePhotoId: "overview-front", box: BOX },
      status: "inspected" as const, reviewedAt: WHEN, notes: "Human checked the connection", scanGroups: [{ linkId: "detail-link", lookupId: "overview", photoIds: ["overview-label"] }] };
    input.map = { document: { version: 3, id: "overview", overview: { lookupId: "overview", photoId: "overview-front", source: OVERVIEW_SOURCE }, components: [componentRecord] }, localRevision: 1, cloudRevision: null, syncedLocalRevision: 0 };
    if (status) input.mapOverviewEvidence = { status, message: "Specific verification result" };
    const before = JSON.stringify(input), doc = parsed(input);
    expect(doc.querySelectorAll(".outline.map")).toHaveLength(0);
    expect(doc.querySelector('[aria-label="Map overview verification"]')?.textContent).toContain(warning);
    expect(doc.querySelector("#component-1")?.textContent).toContain("Human checked the connection");
    expect(doc.querySelector("#component-1")?.textContent).toContain("Inspected — user review");
    expect(doc.querySelector("#component-1 a[href='#scan-1-photo-2']")).not.toBeNull();
    expect(doc.querySelector("#scan-1-photo-1 img")?.getAttribute("src")).toBe(PNG);
    expect(doc.querySelector("#missing-evidence")?.textContent).toContain(warning);
    expect(doc.body.textContent).toContain("Linked photo groups are ID-based associations; their historical image bytes are not bound");
    expect(doc.body.textContent).toContain("matching bytes do not prove a capture angle, vehicle identity");
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each([1, 2] as const)("never treats legacy version %s as verified even when an unrelated status says unchanged", (version) => {
    const input = snapshot(); input.map = { document: { version, id: "overview", overview: { lookupId: "overview", photoId: "overview-front" },
      components: [{ ...component(0), region: { sourcePhotoId: "overview-front", box: BOX } }] }, localRevision: 1, cloudRevision: null, syncedLocalRevision: 0 };
    input.mapOverviewEvidence = { status: "unchanged", message: "Unexpected old status" };
    const doc = parsed(input);
    expect(doc.querySelectorAll(".outline.map")).toHaveLength(0);
    expect(doc.querySelector("#component-map")?.textContent).toContain("legacy map has no recorded overview fingerprint");
    expect(doc.querySelector("#component-1")?.textContent).toContain("Component note 1");
  });

  it("keeps same-name map occurrences and unverified AI locations separate from human notes and outlines", () => {
    const input = snapshot();
    input.map = { document: { version: 2, id: "overview", overview: { lookupId: "overview", photoId: "overview-front" }, components: [
      { ...component(0), label: "Hose", notes: "Owner checked this connection.", suggestedLocation: { source: "ai_scene", text: "upper left <script>fixture</script>" } },
      { ...component(1), label: "Hose", notes: "", suggestedLocation: { source: "ai_scene", text: "lower right" } },
    ] }, localRevision: 2, cloudRevision: null, syncedLocalRevision: 0 };
    const doc = parsed(input);
    expect(doc.querySelectorAll(".component-list > li")).toHaveLength(2);
    expect(doc.querySelector("#component-1")?.textContent).toContain("AI-suggested location — unverified: upper left <script>fixture</script>");
    expect(doc.querySelector("#component-1")?.textContent).toContain("Owner checked this connection.");
    expect(doc.querySelector("#component-2")?.textContent).toContain("AI-suggested location — unverified: lower right");
    expect(doc.querySelector("#component-2")?.textContent).toContain("No component notes recorded.");
    expect(doc.querySelector("#component-2")?.textContent).not.toContain("Owner checked");
    expect(doc.querySelectorAll("#component-map script, #component-map img")).toHaveLength(0);
    expect(doc.querySelector("#component-map")?.textContent).toContain("Suggestions may repeat the same part");
    expect(doc.querySelectorAll('a[href="#component-1"], a[href="#component-2"]')).toHaveLength(0);
    expect(input.map.document.components.every((part) => part.status === "needs_view" && !part.region && !part.reviewedAt)).toBe(true);
  });

  it("links each saved image's review status and targeted disagreements without asserting separate capture angles", () => {
    const record = lookup(); delete record.result!.conditionAssessment;
    record.photos!.push({ id: "overview-mounting", label: "mounting", ...record.frame }, { id: "overview-other", label: "other", ...record.frame });
    record.result!.photoReview = {
      version: 1, photos: [
        { photoId: "overview-front", status: "observations_returned", summary: "A slot <not a confirmed defect> is visible." },
        { photoId: "overview-label", status: "limited_view", summary: "The marking is blurred <script>alert(1)</script>." },
        { photoId: "overview-mounting", status: "not_assessed", summary: "No assessment of this view was returned." },
      ], disagreements: [{ id: "marking-difference", photoIds: ["overview-front", "overview-label"], description: "Markings differ <img src=x onerror=alert(1)>.", nextEvidence: { request: "Show both markings <clearly>.", purpose: "Check identity without assuming the examples match & agree." } }],
    };
    const input = snapshot([record]), before = JSON.stringify(input), document = parsed(input);
    const section = document.querySelector("#scan-1-photo-review")!, rows = section.querySelectorAll(".photo-review-rows > li");
    expect(rows).toHaveLength(4);
    expect(section.textContent).toContain("Saved images may include crops of another image; separate capture angles are not verified.");
    expect(rows[0].querySelector("p")?.textContent).toMatch(/^Photo 1:/);
    expect(rows[3].querySelector("p")?.textContent).toMatch(/^Photo 4:/);
    expect(rows[0].textContent).toContain("Observations returned"); expect(rows[0].textContent).toContain("A slot <not a confirmed defect> is visible.");
    expect(rows[1].textContent).toContain("Limited view"); expect(rows[2].textContent).toContain("Not assessed"); expect(rows[3].textContent).toContain("No review returned");
    rows.forEach((row, index) => expect(row.querySelector("a")?.getAttribute("href")).toBe(`#scan-1-photo-${index + 1}`));
    const disagreement = section.querySelector(".photo-review-disagreements > li")!;
    expect([...disagreement.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual(["#scan-1-photo-1", "#scan-1-photo-2"]);
    expect(disagreement.textContent).toContain("Markings differ <img src=x onerror=alert(1)>.");
    expect(disagreement.textContent).toContain("Referenced saved images:");
    expect(disagreement.textContent).not.toContain("Referenced originals:");
    expect(disagreement.textContent).toContain("Show both markings <clearly>.");
    expect(disagreement.textContent).toContain("Check identity without assuming the examples match & agree.");
    expect(section.textContent).toContain("AI-reported disagreements need confirmation");
    expect(section.textContent).toContain("not proof of complete or correct inspection");
    expect(document.querySelectorAll("script,[onerror],img[src='x']")).toHaveLength(0);
    for (const link of section.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) expect(document.querySelector(link.getAttribute("href")!)).not.toBeNull();
    expect(document.querySelector("#scan-1-photo-1 img")?.getAttribute("src")).toBe(PNG);
    expect(document.querySelector("#scan-1-photo-1 img")?.getAttribute("alt")).toBe("Scan 1, saved photo 1");
    expect(document.querySelector("#scan-1-photo-1 figcaption")?.textContent).toContain("Saved source image: overview-front.");
    expect(document.querySelector("#scan-1-photo-2 figcaption")?.textContent).toContain("This report embeds the saved pixels without further cropping or annotation; the saved image itself may be a crop.");
    expect(document.body.textContent).not.toContain("Saved original:");
    expect(document.body.textContent).toContain("Do not drive until the brake fault is inspected.");
    expect(JSON.stringify(input)).toBe(before);
  });

  it("qualifies empty disagreements while keeping omitted saved images explicitly unreported", () => {
    const record = lookup(); record.result!.photoReview = { version: 1, photos: [{ photoId: "overview-front", status: "observations_returned", summary: "The first original is described." }], disagreements: [] };
    const section = parsed(snapshot([record])).querySelector("#scan-1-photo-review")!;
    expect(section.textContent).toContain("1 of 2 photos have an AI review entry");
    expect(section.querySelectorAll(".photo-review-rows > li")[1].textContent).toContain("No review returned");
    expect(section.textContent).toContain("No disagreements were reported. Agreement between the photos has not been verified.");
    expect(section.querySelectorAll(".photo-review-disagreements > li")).toHaveLength(0);
  });

  it("retains saved image links and source limits when a review is invalid, legacy-unreported or has no AI result", () => {
    const record = lookup(); record.result!.photoReview = { version: 1, photos: [{ photoId: "foreign-photo", status: "observations_returned", summary: "FOREIGN_CLAIM" }], disagreements: [] };
    let document = parsed(snapshot([record])), section = document.querySelector("#scan-1-photo-review")!;
    expect(section.textContent).toContain("The saved photo review could not be validated. Coverage and disagreements are unavailable.");
    expect(section.textContent).not.toContain("FOREIGN_CLAIM");
    expect(section.textContent).not.toContain("foreign-photo");
    expect(section.querySelectorAll(".photo-review-rows > li")).toHaveLength(2);
    expect(document.querySelector("#missing-evidence")?.textContent).toContain("saved per-photo review could not be validated");
    delete record.result!.photoReview;
    document = parsed(snapshot([record])); section = document.querySelector("#scan-1-photo-review")!;
    expect(section.textContent).toContain("Photo-by-photo review was not reported for this result.");
    expect(section.textContent).toContain("Saved images may include crops of another image; separate capture angles are not verified.");
    record.result = undefined;
    section = parsed(snapshot([record])).querySelector("#scan-1-photo-review")!;
    expect(section.textContent).toContain("No AI identification or photo review is recorded.");
    expect(section.textContent).toContain("Saved images may include crops of another image; separate capture angles are not verified.");
    expect([...section.querySelectorAll(".photo-review-rows a")].map((link) => link.getAttribute("href"))).toEqual(["#scan-1-photo-1", "#scan-1-photo-2"]);
  });

  it.each([
    ["same_part_or_area", "Same part or area of one car — reported by the user, not independently verified."],
    ["independent", "Independent examples — do not assume the same part, vehicle or before-and-after sequence."],
    [undefined, "Relationship unknown — a shared part, vehicle or sequence has not been established."],
  ] as const)("exports relationship %s with originals even when the AI assessment is absent", (photoRelationship, description) => {
    const record = lookup(); record.photoRelationship = photoRelationship; record.result = undefined;
    const input = snapshot([record]), before = JSON.stringify(input);
    const document = parsed(input), section = document.querySelector("#scan-1")!;
    expect(section.textContent).toContain(description);
    expect(section.textContent).toContain("Analysis unavailable");
    expect(section.querySelectorAll("figure[id*='-photo-']")).toHaveLength(2);
    expect(section.querySelector("img")?.getAttribute("src")).toBe(PNG);
    expect(section.textContent).not.toContain("Photo-linked AI condition observations");
    expect(section.textContent).toContain("No main identification is recorded.");
    if (photoRelationship !== "same_part_or_area") expect(section.textContent).toContain("Saved selection and supplied vehicle or complaint details, when present, refer to Photo 1.");
    else expect(section.textContent).toContain("User-reported photo relationship");
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each([
    ["identify-pipeline-2026-11-05-photo-relationship-v1", "The main identification refers to Photo 1."],
    ["identify-pipeline-2026-11-05-confirmed-vehicle-v1", "The main identification's per-photo scope was not recorded."],
    [undefined, "The main identification's per-photo scope was not recorded."],
  ] as const)("does not infer historical identity attribution from an unknown relationship: %s", (pipelineVersion, expected) => {
    const record = lookup(); record.result!.modelRun!.pipelineVersion = pipelineVersion;
    const document = parsed(snapshot([record])), section = document.querySelector("#scan-1")!;
    expect(section.textContent).toContain(expected);
    expect(section.textContent).toContain("Saved selection and supplied vehicle or complaint details, when present, refer to Photo 1.");
    expect(section.textContent).not.toContain("No main identification is recorded.");
    if (pipelineVersion !== "identify-pipeline-2026-11-05-photo-relationship-v1") expect(section.textContent).not.toContain("The main identification refers to Photo 1.");
  });

  it.each(["independent", undefined] as const)("limits each group's supplied vehicle and complaint to Photo 1 when relationship is %s", (photoRelationship) => {
    const first = lookup(), second = lookup("other-car");
    first.result = undefined; first.photoRelationship = photoRelationship;
    first.vehicleContext = { make: "Toyota", model: "Corolla", symptom: "First car shakes at idle" };
    second.result = undefined; second.photoRelationship = photoRelationship;
    second.vehicleContext = { make: "Honda", model: "Civic", symptom: "Other car makes a clicking sound" };
    const input = snapshot([first, second]), before = JSON.stringify(input), document = parsed(input);
    const a = document.querySelector("#scan-1")!, b = document.querySelector("#scan-2")!;
    for (const section of [a, b]) {
      expect([...section.querySelectorAll("h3")].some((heading) => heading.textContent === "Saved vehicle and complaint — Photo 1")).toBe(true);
      expect(section.textContent).toContain("supplied vehicle or complaint details, when present, refer to Photo 1.");
      expect(section.querySelectorAll("figure[id*='-photo-']")).toHaveLength(2);
    }
    expect(a.textContent).toContain("Corolla"); expect(a.textContent).toContain("First car shakes at idle");
    expect(a.textContent).not.toContain("Other car makes a clicking sound");
    expect(b.textContent).toContain("Civic"); expect(b.textContent).toContain("Other car makes a clicking sound");
    expect(b.textContent).not.toContain("First car shakes at idle");
    expect(JSON.stringify(input)).toBe(before);
  });

  it("does not render arbitrary relationship text as HTML or as a verified association", () => {
    const record = lookup();
    record.photoRelationship = '<img src="https://untrusted.invalid/relationship" onerror="alert(1)">' as PhotoRelationship;
    record.result!.partName = "Possible part <not confirmed>";
    const document = parsed(snapshot([record]));
    expect(document.querySelector("#scan-1")?.textContent).toContain("Relationship unknown");
    expect(document.body.textContent).toContain("Possible part <not confirmed>");
    expect(document.querySelector("not")).toBeNull();
    expect(document.querySelectorAll("script,[onerror],img[src^='https:']")).toHaveLength(0);
    expect(document.body.textContent).not.toContain("untrusted.invalid");
    expect(document.querySelector("#scan-1 img")?.getAttribute("src")).toBe(PNG);
  });

  it("exports two verified originals, historical context, honest dates and reversible display alignment", () => {
    const record = visualComparison(); const input = snapshot([lookup(), lookup("previous")]);
    input.comparisonLogs = [{ lookupId: "overview", records: [record], cloudChecked: false }];
    input.comparisonEvidence = ["earlier", "current"].map((side) => ({ lookupId: record.lookupId, recordId: record.id, side: side as "earlier" | "current", status: "unchanged" }));
    const doc = parsed(input); const section = doc.querySelector("#dated-comparisons")!;
    expect(section.querySelectorAll("img")).toHaveLength(2);
    expect(section.textContent).toContain("Observation date — user reported"); expect(section.textContent).toContain("Unknown");
    expect(section.textContent).toContain("Wet in second photograph"); expect(section.textContent).toContain("Historical model");
    expect(section.textContent).toContain("Could be lighting <script>"); expect(doc.querySelectorAll("script")).toHaveLength(0);
    expect(doc.body.textContent).not.toContain("PRIVATE_COMPARISON_VIN"); expect(doc.body.textContent).toContain("Do not drive until the brake fault is inspected.");
    expect(section.querySelectorAll("img")[1].getAttribute("style")).toContain("rotate(15deg) scale(1.2)");
    expect(section.querySelectorAll("img")[1].getAttribute("style")).toContain("height:100%;object-fit:contain");
    expect(section.querySelector(".comparison-viewport")?.getAttribute("style")).toContain("aspect-ratio:4/3");
    for (const link of section.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) expect(doc.querySelector(link.getAttribute("href")!)).not.toBeNull();
    expect(parsed(input, { includeVin: true, includePrivateNotes: false }).body.textContent).toContain("PRIVATE_COMPARISON_VIN");
  });

  it("exports the immutable requested-photo guide, provenance and exact photo links without claiming resolution", () => {
    const input = withRequestedHistory(snapshot([lookup(), lookup("followup")]));
    const receipt = input.requestedEvidenceHistory!.records[0], before = JSON.stringify(input);
    delete input.scans[0].result;
    const doc = parsed(input), history = doc.querySelector("#requested-photo-history")!, guide = doc.querySelector(".requested-photo-receipt")!;
    expect(history.textContent).toContain("device history only"); expect(history.textContent).toContain("Cloud follow-ups were not searched");
    expect(history.textContent).toContain("not reviewed"); expect(history.textContent).toContain("does not establish");
    expect(guide.textContent).toContain(receipt.requestedEvidence.request); expect(guide.textContent).toContain(receipt.requestedEvidence.purpose);
    expect(guide.textContent).toContain("historical-analysis"); expect(guide.textContent).toContain(receipt.analysisSha256);
    expect(guide.textContent).toContain("recorded, not reverified"); expect(guide.textContent).toContain("other cited photos");
    expect(doc.querySelectorAll("script,[onerror],img[src^='http']")).toHaveLength(0);
    const comparison = doc.querySelector(".comparison-record")!;
    expect(comparison.querySelectorAll("img")).toHaveLength(2);
    for (const image of comparison.querySelectorAll("img")) expect(image.getAttribute("src")).toBe(PNG);
    expect(guide.querySelector('a[href="#scan-1-photo-1"]')).not.toBeNull(); expect(guide.querySelector('a[href="#scan-1-photo-2"]')).not.toBeNull();
    for (const link of history.querySelectorAll("a")) expect(doc.querySelector(link.getAttribute("href")!)).not.toBeNull();
    expect(JSON.stringify(input.requestedEvidenceHistory)).toBe(JSON.stringify(JSON.parse(before).requestedEvidenceHistory));
    expect(doc.body.textContent).not.toContain("PRIVATE_COMPARISON_VIN");
  });

  it("keeps request history and its human correction when the follow-up images are unavailable", () => {
    const first = requestedReceipt(), correction = { ...first, id: "30000000-0000-4000-8000-000000000002", supersedesId: first.id, correctionReason: "Clarify the human note", observation: { outcome: "inconclusive" as const, notes: "Label remains unreadable." } };
    const input = withRequestedHistory(snapshot(), [first, correction]);
    input.comparisonEvidence!.forEach((item) => { item.status = "missing_photo"; });
    const doc = parsed(input), history = doc.querySelector("#requested-photo-history")!, section = doc.querySelector("#dated-comparisons")!;
    expect(history.querySelectorAll("li")).toHaveLength(2); expect(section.querySelectorAll(".requested-photo-receipt")).toHaveLength(2);
    expect(section.textContent).toContain(first.requestedEvidence.request); expect(section.textContent).toContain("Label remains unreadable.");
    expect(section.textContent).toContain("superseded"); expect(section.textContent).toContain("Historical original unavailable or unverified");
    expect(section.querySelectorAll("img")).toHaveLength(0);
    expect(section.querySelector('a[href="#comparison-1-1"]')).not.toBeNull();
  });

  it("distinguishes an incomplete reverse search from no collected history or a complete empty device search", () => {
    const input = withRequestedHistory(snapshot(), []);
    input.requestedEvidenceHistory!.complete = false; input.requestedEvidenceHistory!.reason = "A device bucket was unreadable <retry>.";
    const incomplete = parsed(input).querySelector("#requested-photo-history")!;
    expect(incomplete.textContent).toContain("A device bucket was unreadable <retry>.");
    expect(incomplete.textContent).toContain("this is not a complete search");
    expect(incomplete.textContent).not.toContain("search completed");
    input.requestedEvidenceHistory!.complete = true; delete input.requestedEvidenceHistory!.reason;
    expect(parsed(input).querySelector("#requested-photo-history")!.textContent).toContain("No requested-photo entries were found in the device history read");
    delete input.requestedEvidenceHistory;
    expect(parsed(input).querySelector("#requested-photo-history")!.textContent).toContain("was not collected");
  });

  it("rejects a discovered receipt omitted or changed in the frozen comparison histories", () => {
    const input = withRequestedHistory(snapshot()); input.comparisonLogs = [];
    expect(() => parsed(input)).toThrow(/missing or inconsistent/);
    withRequestedHistory(input);
    input.comparisonLogs![0].records = [{ ...requestedReceipt(), requestedEvidence: { ...requestedReceipt().requestedEvidence, purpose: "A conflicting purpose." } }];
    expect(() => parsed(input)).toThrow(/missing or inconsistent/);
  });

  it("retains corrections and unavailable comparison observations without substituting another original", () => {
    const record = visualComparison(); const corrected = { ...record, id: "30000000-0000-4000-8000-000000000002", supersedesId: record.id, correctionReason: "Misread lighting", observation: { outcome: "inconclusive" as const, notes: "Need same view" } };
    const input = snapshot(); input.comparisonLogs = [{ lookupId: "overview", records: [record, corrected], cloudChecked: true }];
    input.comparisonEvidence = [record, corrected].flatMap((entry) => (["earlier", "current"] as const).map((side) => ({ lookupId: entry.lookupId, recordId: entry.id, side, status: side === "earlier" ? "missing_photo" as const : "source_changed" as const })));
    const doc = parsed(input); const section = doc.querySelector("#dated-comparisons")!;
    expect(section.querySelectorAll(".comparison-record")).toHaveLength(2); expect(section.querySelectorAll("img")).toHaveLength(0);
    expect(section.textContent).toContain("superseded"); expect(section.textContent).toContain("Need same view");
    expect(section.textContent).toContain("Historical original unavailable or unverified");
    expect(section.querySelector('a[href="#comparison-1-1"]')).not.toBeNull();
    expect(doc.querySelector("#missing-evidence")?.textContent).toContain("historical evidence was not verified");
  });
  it("preserves exact human readings, corrections, original photo links and private identity boundaries", () => {
    const first = humanMeasurement();
    const correction = { ...first, id: "10000000-0000-4000-8000-000000000002", recordedAt: "2026-11-05T13:00:00.000Z", reading: "2.10", supersedesId: first.id, correctionReason: "Transcription correction <keep original>" };
    const input = snapshot(); input.serviceLogs = [{ lookupId: "overview", records: [first, correction], cloudChecked: true }];
    const document = parsed(input); const text = document.body.textContent!;
    expect(document.querySelectorAll(".service-record")).toHaveLength(2);
    expect(text).toContain("2.00"); expect(text).toContain("2.10"); expect(text).toContain("superseded");
    expect(text).toContain("Transcription correction <keep original>"); expect(text).toContain("original-analysis");
    expect(text).toContain("123000"); expect(text).not.toContain("PRIVATE_SERVICE_RECORDER"); expect(text).not.toContain(first.vehicleContext!.vin);
    expect(document.querySelector("#scan-1-service-2 a[href='#scan-1-service-1']")).not.toBeNull();
    expect(document.querySelector("#scan-1-service-1 a[href='#scan-1-photo-1']")).not.toBeNull();
    expect(document.querySelectorAll("script")).toHaveLength(0);
    expect(parsed(input, { includeVin: true, includePrivateNotes: true }).body.textContent).toContain(first.vehicleContext!.vin);
    expect(parsed(input, { includeVin: true, includePrivateNotes: true }).body.textContent).not.toContain("PRIVATE_SERVICE_RECORDER");
  });

  it("keeps reported repair completion separate from a linked follow-up and the existing safety action", () => {
    const common = humanMeasurement();
    const repair: ServiceRecord = { version: 1, id: common.id, lookupId: common.lookupId, recordedAt: common.recordedAt, occurredOn: common.occurredOn,
      recordedBy: common.recordedBy, basis: common.basis, subject: common.subject, photoIds: common.photoIds, notes: "Cause not established",
      kind: "repair", action: "Reported bracket replacement", status: "completed", parts: "Reported replacement bracket" };
    const input = snapshot(); input.serviceLogs = [{ lookupId: "overview", records: [repair], cloudChecked: false }];
    expect(parsed(input).body.textContent).toContain("Follow-up not recorded for this repair entry");
    const followUp: ServiceRecord = { ...repair, id: "10000000-0000-4000-8000-000000000002", recordedAt: "2026-11-05T13:00:00.000Z",
      kind: "follow_up", check: "Owner reports no rattle during brief stationary check", outcome: "symptom_not_observed", conditions: "Stationary", relatedRecordIds: [repair.id] };
    // Construct only the follow-up's own fields, not the repair payload.
    delete (followUp as unknown as Record<string, unknown>).action;
    delete (followUp as unknown as Record<string, unknown>).status;
    delete (followUp as unknown as Record<string, unknown>).parts;
    input.serviceLogs[0].records.push(followUp);
    const document = parsed(input);
    expect(document.body.textContent).toContain("Separately recorded follow-up");
    expect(document.body.textContent).toContain("Do not drive until the brake fault is inspected.");
    expect(document.body.textContent).toContain("A symptom not observed during one check may recur");
    expect(document.body.textContent).toContain("Cloud history was not verified");
    expect(document.querySelector("#scan-1-service-2 a[href='#scan-1-service-1']")).not.toBeNull();
  });

  it("shows missing human evidence references without silently relinking to another photo", () => {
    const input = snapshot(); input.serviceLogs = [{ lookupId: "overview", records: [{ ...humanMeasurement(), photoIds: ["removed-photo"] }], cloudChecked: true }];
    const document = parsed(input);
    expect(document.querySelector(".service-record")?.textContent).toContain("removed-photo Unavailable");
    expect(document.querySelector("#missing-evidence")?.textContent).toContain("Photo removed-photo");
    for (const link of document.querySelectorAll<HTMLAnchorElement>("a[href^='#']")) expect(document.getElementById(link.hash.slice(1))).not.toBeNull();
  });

  it("renders retained history for an unavailable linked scan with its own context, corrections and missing original references", () => {
    const input = snapshot();
    const first = { ...humanMeasurement(), lookupId: "missing-scan", photoIds: ["historic-angle"], vehicleContext: { model: "Historical vehicle" } };
    const correction = { ...first, id: "10000000-0000-4000-8000-000000000002", supersedesId: first.id, correctionReason: "Keep original evidence", reading: "2.10" };
    input.serviceLogs = [{ lookupId: "missing-scan", records: [first, correction], cloudChecked: false }];
    input.missing = [{ kind: "lookup", lookupId: "missing-scan", message: "This linked saved scan is unavailable." }];
    const document = parsed(input);
    const section = document.querySelector("#unavailable-service-history")!;
    expect(section.textContent).toContain("original scan metadata and photos are unavailable");
    expect(section.textContent).toContain("Historical vehicle");
    expect(section.textContent).toContain("2.00"); expect(section.textContent).toContain("2.10");
    expect(section.textContent).toContain("historic-angle Unavailable");
    expect(section.querySelectorAll(".service-record")).toHaveLength(2);
    expect(section.querySelectorAll("img")).toHaveLength(0);
    expect(section.textContent).not.toContain("PRIVATE_SERVICE_RECORDER");
    expect(section.querySelector("a[href='#unavailable-service-1-service-1']")).not.toBeNull();
    for (const link of document.querySelectorAll<HTMLAnchorElement>("a[href^='#']")) expect(document.getElementById(link.hash.slice(1))).not.toBeNull();
  });

  it("does not describe a successful cloud check as a successful device history read", () => {
    const input = snapshot();
    input.serviceLogs = [{ lookupId: "overview", records: [humanMeasurement()], cloudChecked: true }];
    input.missing = [{ kind: "service_records", lookupId: "overview", message: "Human records on this device could not be read." }];
    const text = parsed(input).body.textContent!;
    expect(text).toContain("Cloud human-service history was checked");
    expect(text).toContain("does not mean both sources were available");
    expect(text).toContain("Human records on this device could not be read");
    expect(text).not.toContain("Includes the device and cloud records");
  });

  it("rejects invalid human-service snapshots instead of emitting a report with silently discarded records", () => {
    const input = snapshot(); input.serviceLogs = [{ lookupId: "overview", records: [{ ...humanMeasurement(), version: 3 } as unknown as ServiceRecord], cloudChecked: true }];
    expect(() => buildInspectionReportHtml(input)).toThrow(/could not be read safely/);
    input.serviceLogs = [{ lookupId: "overview", records: [], cloudChecked: true }, { lookupId: "overview", records: [], cloudChecked: true }];
    expect(() => buildInspectionReportHtml(input)).toThrow(/duplicate human-service histories/);
  });

  it("includes all 12 components and distinct saved associations while deduplicating scan sections and assets", () => {
    const overview = lookup(); const detail = lookup("detail");
    const input = snapshot([overview, detail, detail]);
    const components = Array.from({ length: 12 }, (_, index) => component(index));
    components[0].region = { sourcePhotoId: "overview-front", box: BOX };
    components[1].status = "inspected"; components[1].reviewedAt = WHEN;
    components[2].status = "not_visible"; components[2].region = { sourcePhotoId: "overview-front", box: BOX };
    components[11].scanGroups = [{ linkId: "first", lookupId: detail.id, photoIds: ["detail-front", "detail-label"] }, { linkId: "duplicate", lookupId: detail.id, photoIds: ["detail-label", "detail-front"] }];
    components[0].scanGroups = [{ linkId: "other-association", lookupId: detail.id, photoIds: ["detail-label"] }];
    input.map = { document: { version: 3, id: overview.id, overview: { lookupId: overview.id, photoId: "overview-front", source: OVERVIEW_SOURCE }, components }, localRevision: 8, cloudRevision: 3, syncedLocalRevision: 5 };
    input.mapOverviewEvidence = { status: "unchanged", message: "The embedded overview matches the bound source." };
    const document = parsed(input);
    expect(document.querySelectorAll(".component-list > li")).toHaveLength(12);
    expect(document.querySelectorAll("section[id^='scan-']")).toHaveLength(2);
    expect(document.querySelector("#component-12")?.textContent).toContain("Component note 12");
    expect(document.querySelectorAll("#component-12 .linked-photo-group")).toHaveLength(2);
    expect(document.querySelectorAll("#component-12 a[href='#scan-2-photo-1']")).toHaveLength(2);
    expect(document.querySelectorAll("#component-12 a[href='#scan-2-photo-2']")).toHaveLength(2);
    expect(document.querySelectorAll("#component-1 a[href='#scan-2-photo-2']")).toHaveLength(1);
    expect(document.querySelectorAll("figure[id*='-photo-']")).toHaveLength(4);
    expect(document.querySelector(".outline.map[href='#component-1']")).not.toBeNull();
    expect(document.querySelector("#component-map")?.textContent).toContain("matches the map's recorded source fingerprint and timestamps");
    expect(document.querySelector(".outline.map[href='#component-3']")).toBeNull();
    expect(document.querySelector("#component-3")?.textContent).toContain("Not visible");
    expect(document.querySelector("#component-2")?.textContent).toContain("not a safety certification");
    expect(document.body.textContent).toContain("Local map changes are not acknowledged");
    // One copy of identical original bytes is enough for several photo/group associations.
    expect(document.querySelectorAll("img")).toHaveLength(1);
  });

  it("keeps missing-photo anchors and their observations while inventorying all missing evidence", () => {
    const record = lookup(); record.photos![1].imageBase64 = "";
    const input = snapshot([record]); input.missing = [{ kind: "photo", lookupId: record.id, photoId: "overview-label", message: "The signed asset could not be retrieved." }];
    input.map = { document: { version: 1, id: record.id, overview: { lookupId: record.id, photoId: "overview-front" }, components: [{ ...component(0), scanGroups: [{ linkId: "missing", lookupId: "missing-detail", photoIds: ["missing-photo"] }] }] }, localRevision: 1, cloudRevision: null, syncedLocalRevision: 0 };
    const document = parsed(input);
    expect(document.querySelector("#scan-1-photo-2")?.textContent).toContain("Image unavailable");
    expect(document.querySelector("#scan-1-observation-1 a[href='#scan-1-photo-2']")).not.toBeNull();
    expect(document.body.textContent).toContain("Orange-brown material is visible.");
    expect(document.querySelector("#missing-evidence")?.textContent).toContain("signed asset could not be retrieved");
    expect(document.querySelector("#missing-evidence")?.textContent).toContain("missing-detail");
    expect(document.querySelector("#component-1")?.textContent).toContain("Unavailable");
  });

  it("does not apply first-photo geometry to later originals, or interpret textual regions as boxes", () => {
    const record = lookup(); record.focusBox = BOX; record.focusMode = "crop";
    const document = parsed(snapshot([record]));
    expect(document.querySelectorAll("#scan-1-photo-1 .outline")).toHaveLength(1);
    expect(document.querySelectorAll("#scan-1-photo-2 .outline")).toHaveLength(0);
    expect(document.body.textContent).toContain("Textual region: lower edge (not a geometric annotation)");
    expect(document.querySelector("#scan-1-photo-1 input[type='checkbox']")).not.toBeNull();
    expect(document.querySelector("#scan-1-photo-1 img")?.getAttribute("src")).toBe(PNG);
  });

  it("distinguishes a real saved mask from a corrected crop and never exports a stale crop cutout", () => {
    const record = lookup();
    record.isolatedObjects = [
      { name: "Saved mask part", category: "brakes", primary: true, focusBox: BOX, focusMode: "mask", isolatedImageBase64: PNG },
      { name: "Corrected crop part", category: "brakes", primary: false, focusBox: { ...BOX, x: .2 }, focusMode: "crop", correctedAt: WHEN, isolatedImageBase64: "data:image/png;base64,STALE_CROP_BYTES" },
    ];
    const document = parsed(snapshot([record]));
    expect(document.querySelector("#scan-1-selection-1")?.textContent).toContain("Saved segmentation-mask cutout");
    expect(document.querySelector("#scan-1-selection-2")?.textContent).toContain("User-corrected crop selection");
    expect(document.querySelector("#scan-1-selection-2")?.textContent).toContain("not a segmentation mask");
    expect(document.documentElement.outerHTML).not.toContain("STALE_CROP_BYTES");
    expect(document.querySelector("#scan-1-selection-2 img")).toBeNull();
    expect(document.querySelector("#scan-1-selection-2 a")?.getAttribute("href")).toBe("#scan-1-photo-1");
  });

  it("preserves safety instructions, unconfirmed causes, unknowns, request purposes and AI measurement methods", () => {
    const record = lookup(); record.result!.measurements = [{ label: "Rotor diameter", valueMm: 280, confidence: "low", method: "estimated", caveat: "No scale reference is visible." }];
    record.correction = "User corrected rotor label";
    record.inspection = { confirmedPartName: "Human recorded rotor label", partNumber: "ABC123", identityEvidence: "Read stamped marking", visibleCondition: "uncertain", visibleNotes: "Needs cleaning", functionalStatus: "not_tested", functionalNotes: "No road test performed", inspectorName: "PRIVATE_INSPECTOR", inspectedAt: WHEN };
    const document = parsed(snapshot([record])); const text = document.body.textContent!;
    for (const expected of ["Do not drive until the brake fault is inspected.", "Corrosion may explain", "unconfirmed hypotheses", "Remaining thickness is unknown.", "Photos do not establish braking performance.", "Compare remaining thickness with its service limit.", "Read the minimum-thickness marking.", "Measure thickness using the specified method.", "AI-reported dimensions — not human measurements", "estimated", "No scale reference is visible.", "User corrected rotor label", "Human recorded rotor label", "Possible brake rotor", "not tested", "No road test performed", "fixture-model", "fixture-prompt"]) expect(text).toContain(expected);
    expect(document.querySelector(".safety")?.textContent).toContain("Do not drive");
    expect(document.querySelector("a[href='#scan-1-observation-1']")).not.toBeNull();
    expect(text).not.toContain("PRIVATE_INSPECTOR");
  });

  it("omits private identity fields and chats even when VIN and private notes are explicitly included", () => {
    const record = lookup();
    record.vehicleContext = confirmVehicleContextField({ year: "2014", make: "Toyota", mileage: "90000", mileageUnit: "km", modifications: { status: "modified", details: "Aftermarket intake" }, symptom: "Noise when cold", vin: "1HGCM82633A004352", notes: "PRIVATE_VEHICLE_NOTE", customerName: "PRIVATE_CUSTOMER", plate: "PRIVATE_PLATE", technicianName: "PRIVATE_TECH", bayOrRo: "PRIVATE_RO", jobTitle: "PRIVATE_JOB_TITLE" }, "make", true, WHEN);
    record.jobId = "PRIVATE_JOB_ID"; record.technicianUserId = "PRIVATE_TECH_ID";
    record.chatHistory = [{ id: "private-chat", role: "user", content: "PRIVATE_CHAT", timestamp: WHEN }];
    record.customerVisibleReport = { title: "Private report", summary: "PRIVATE_CUSTOMER_REPORT", generatedAt: WHEN };
    const defaults = buildInspectionReportHtml(snapshot([record]));
    const optedIn = buildInspectionReportHtml(snapshot([record]), { includeVin: true, includePrivateNotes: true });
    for (const privateValue of ["1HGCM82633A004352", "PRIVATE_SCAN_CANARY", "PRIVATE_VEHICLE_NOTE"]) { expect(defaults).not.toContain(privateValue); expect(optedIn).toContain(privateValue); }
    for (const alwaysPrivate of ["PRIVATE_CUSTOMER", "PRIVATE_PLATE", "PRIVATE_TECH", "PRIVATE_RO", "PRIVATE_JOB_TITLE", "PRIVATE_JOB_ID", "PRIVATE_TECH_ID", "PRIVATE_CHAT", "PRIVATE_CUSTOMER_REPORT"]) expect(optedIn).not.toContain(alwaysPrivate);
    for (const supplied of ["Toyota — user-confirmed (self-reported)", "90000 km", "Aftermarket intake", "Noise when cold"]) expect(defaults).toContain(supplied);
  });

  it("uses each scan's saved vehicle, including when no condition assessment or AI result exists", () => {
    const first = lookup(); const second = lookup("second");
    first.vehicleContext = { make: "First car", symptom: "First complaint" };
    second.vehicleContext = { make: "Second car", engine: "Second engine", symptom: "Second complaint" }; delete second.result;
    const document = parsed(snapshot([first, second]));
    expect(document.querySelector("#scan-1")?.textContent).toContain("First car");
    expect(document.querySelector("#scan-1")?.textContent).not.toContain("Second complaint");
    expect(document.querySelector("#scan-2")?.textContent).toContain("Second engine");
    expect(document.querySelector("#scan-2")?.textContent).toContain("Second complaint");
    expect(document.querySelector("#scan-2")?.textContent).toContain("No AI result is saved");
  });

  it("qualifies defaultable cloud provenance without treating it as proof of camera use or model execution", () => {
    const record = lookup(); record.cloudRevision = 3; record.provenance.captureMode = "camera";
    const document = parsed(snapshot([record])); const text = document.querySelector("#scan-1")!.textContent!;
    expect(text).toContain("Stored capture mode (may be defaulted on cloud restore)");
    expect(text).toContain("Stored analysis source (may be defaulted on cloud restore)");
    expect(text).toContain("Saved/creation timestamp");
    expect(text).toContain("do not prove camera use or model execution");
    expect(text).toContain("including after a cloud record was saved on this device");
    expect(text).toContain("fixture-model");
    expect([...document.querySelectorAll("dt")].map((node) => node.textContent)).not.toContain("Capture mode");
  });

  it("escapes hostile text and attributes and emits no executable or external assets", () => {
    const record = lookup(); const hostile = '</style><script>alert("x")</script><img src=x onerror=alert(1)>';
    record.correction = hostile; record.result!.visibleObservations = [hostile]; record.photos![0].id = hostile;
    record.result!.sourceLinks = [{ label: hostile, url: "javascript:alert(document.cookie)", sourceType: "reference" }];
    record.result!.conditionAssessment = undefined;
    const input = snapshot([record]); input.missing = [{ kind: "photo", lookupId: record.id, message: hostile }];
    const document = parsed(input);
    expect(document.querySelectorAll("script, iframe, object, embed, link, form, [onerror], [onclick]")).toHaveLength(0);
    expect(document.body.textContent).toContain(hostile);
    expect(document.querySelectorAll("img")).toHaveLength(1);
    for (const link of document.querySelectorAll("a")) expect(link.getAttribute("href")).toMatch(/^#/);
    expect(document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toContain("default-src 'none'; img-src data:");
    expect(document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toContain("base-uri 'none'; form-action 'none'");
  });

  it.each(["https://assets.invalid/signed?token=secret", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=", "data:image/png;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==", "data:image/jpeg;base64,aW52YWxpZA==", "data:image/png;base64,AAAA\" onerror=\"x", "data:image/png;base64,AA=A", "data:image/png;base64,"])("independently rejects an unsafe or invalid image: %s", (image) => {
    const record = lookup(); record.photos = [{ id: "overview-front", label: "overview", capturedAt: WHEN, imageBase64: image }];
    const document = parsed(snapshot([record]));
    expect(document.querySelectorAll("img")).toHaveLength(0);
    expect(document.querySelector("#missing-evidence")?.textContent).toContain("not an embedded supported raster");
    expect(document.documentElement.outerHTML).not.toContain("token=secret");
  });

  it("states map conflicts and pending saves without exporting or silently merging the cloud document", () => {
    const input = snapshot();
    const local = { version: 1 as const, id: "overview", overview: { lookupId: "overview", photoId: "overview-front" }, components: [component(0)] };
    input.map = { document: local, localRevision: 4, cloudRevision: 2, syncedLocalRevision: 3, syncAttempt: { id: "attempt", localRevision: 3, startedAt: WHEN }, conflict: { document: { ...local, components: [{ ...component(0), label: "CLOUD_ONLY_LABEL" }] }, revision: 5 } };
    const text = parsed(input).body.textContent!;
    expect(text).toContain("Unresolved cloud conflict at cloud revision 5");
    expect(text).toContain("cloud save attempt for local revision 3 is unacknowledged");
    expect(text).toContain("Saved component 1"); expect(text).not.toContain("CLOUD_ONLY_LABEL");
  });

  it("supports legacy photo-1 and ignores invalid assessment links without inventing evidence", () => {
    const record = lookup(); delete record.photos;
    record.result!.conditionAssessment!.observations[0].photoIds = ["photo-1"];
    record.result!.conditionAssessment!.nextEvidence!.photoIds = ["photo-1"];
    expect(parsed(snapshot([record])).querySelector("#scan-1-observation-1 a")?.getAttribute("href")).toBe("#scan-1-photo-1");
    record.result!.conditionAssessment!.observations[0].photoIds = ["invented"];
    const document = parsed(snapshot([record]));
    expect(document.querySelector("#scan-1-observation-1")).toBeNull();
    expect(document.body.textContent).toContain("A rough edge is visible.");
    expect(document.querySelector("#missing-evidence")?.textContent).toContain("invalid condition-assessment references");
  });

  it("retains long saved findings and notes without truncation, and leaves its input untouched", () => {
    const input = snapshot(); input.scans[0].result!.visibleObservations = ["Full saved finding. ".repeat(600) + "END_FINDING"];
    input.scans[0].notes = "Saved private note. ".repeat(600) + "END_NOTE";
    const before = JSON.stringify(input); const html = buildInspectionReportHtml(input, { includeVin: false, includePrivateNotes: true });
    expect(html).toContain(input.scans[0].result!.visibleObservations[0]); expect(html).toContain(input.scans[0].notes);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("fails rather than producing a partial report above the hard size limit", () => {
    const record = lookup(); record.photos![0].imageBase64 = "data:image/png;base64," + "A".repeat(MAX_INSPECTION_REPORT_HTML_BYTES);
    expect(() => buildInspectionReportHtml(snapshot([record]))).toThrow("64 MiB limit");
  });

  it("uses a privacy-safe, path-safe filename", () => {
    expect(getInspectionReportFilename(snapshot())).toBe("deepspec-inspection-2026-11-05.html");
    const input = snapshot(); input.createdAt = '../../private<script>.html';
    expect(getInspectionReportFilename(input)).toBe("deepspec-inspection-undated.html");
  });
});
