import { describe, expect, it } from "vitest";
import type { Lookup, VisualFocusBox } from "../types";
import type { ComponentMapComponent } from "../types/componentMap";
import type { InspectionReportSnapshot } from "../types/inspectionReport";
import { buildInspectionReportHtml, getInspectionReportFilename, MAX_INSPECTION_REPORT_HTML_BYTES } from "./inspectionReportHtml";
import { confirmVehicleContextField } from "./vehicleContext";

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

describe("self-contained mechanic HTML report", () => {
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
