import { describe, expect, it } from "vitest";
import type { Lookup, PhotoRelationship, VisualFocusBox } from "../types";
import type { ComponentMapComponent } from "../types/componentMap";
import type { InspectionReportSnapshot } from "../types/inspectionReport";
import { buildInspectionReportHtml, getInspectionReportFilename, MAX_INSPECTION_REPORT_HTML_BYTES } from "./inspectionReportHtml";
import { confirmVehicleContextField } from "./vehicleContext";
import type { ServiceRecord } from "../types/serviceRecord";
import type { InspectionComparison, ComparisonSide } from "../types/inspectionComparison";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/bKkAAAAASUVORK5CYII=";
const WHEN = "2026-11-05T12:00:00Z";
const BOX: VisualFocusBox = { x: .1, y: .2, width: .3, height: .4, confidence: .8 };

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

function humanMeasurement(): Extract<ServiceRecord, { kind: "measurement" }> {
  return { version: 1, id: "10000000-0000-4000-8000-000000000001", lookupId: "overview", recordedAt: "2026-11-05T12:00:00.000Z", occurredOn: "2026-11-04",
    recordedBy: "PRIVATE_SERVICE_RECORDER", basis: "personally_performed", subject: "Lower bracket edge", photoIds: ["overview-front"], notes: "Calibration unknown; no service limit supplied",
    analysisAttemptId: "original-analysis", vehicleContext: { year: "2010", make: "Example", model: "Test", mileage: "123000", mileageUnit: "mi", vin: "1HGBH41JXMN109186" },
    kind: "measurement", quantity: "Thickness", reading: "2.00", unit: "mm", method: "Caliper across marked location", instrument: "Unverified caliper", conditions: "Dry", noReadingReason: "" };
}

function visualComparison(): InspectionComparison {
  const side = (lookupId: string): ComparisonSide => ({ lookupId, photoId: `${lookupId}-label`, photoLabel: "marking", photoAddedAt: WHEN, scanSavedAt: WHEN,
    sha256: "a".repeat(64), width: 1, height: 1, observedOn: null, vehicleContext: { vin: "PRIVATE_COMPARISON_VIN", model: "Historical model" } });
  return { version: 1, id: "30000000-0000-4000-8000-000000000001", lookupId: "overview", recordedAt: WHEN, subject: "Bracket comparison <original>",
    earlier: side("previous"), current: side("overview"), relationship: { sameVehicle: true, component: "same_part", basis: "Owner identified location" },
    conditions: { angle: "different", lighting: "unknown", surfaceNotes: "Wet in second photograph" }, observation: { outcome: "inconclusive", notes: "Could be lighting <script>" },
    alignment: { rotation: 15, scale: 1.2, offsetX: .1, offsetY: -.1 } };
}

describe("self-contained mechanic HTML report", () => {
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
    input.map = { document: { version: 1, id: overview.id, overview: { lookupId: overview.id, photoId: "overview-front" }, components }, localRevision: 8, cloudRevision: 3, syncedLocalRevision: 5 };
    const document = parsed(input);
    expect(document.querySelectorAll(".component-list > li")).toHaveLength(12);
    expect(document.querySelectorAll("section[id^='scan-']")).toHaveLength(2);
    expect(document.querySelector("#component-12")?.textContent).toContain("Component note 12");
    expect(document.querySelectorAll("#component-12 li")).toHaveLength(2);
    expect(document.querySelectorAll("#component-12 a[href='#scan-2-photo-1']")).toHaveLength(2);
    expect(document.querySelectorAll("#component-12 a[href='#scan-2-photo-2']")).toHaveLength(2);
    expect(document.querySelectorAll("#component-1 a[href='#scan-2-photo-2']")).toHaveLength(1);
    expect(document.querySelectorAll("figure[id*='-photo-']")).toHaveLength(4);
    expect(document.querySelector(".outline.map[href='#component-1']")).not.toBeNull();
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
