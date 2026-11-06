import type { Lookup, ScanPhoto, VehicleContext, VisualFocusBox } from "../types";
import type { ComponentMapComponent } from "../types/componentMap";
import { DEFAULT_INSPECTION_REPORT_OPTIONS, type InspectionReportOptions, type InspectionReportSnapshot } from "../types/inspectionReport";
import { normalizeConditionAssessment } from "./conditionAssessment";
import { normalizeObservationAreaRecords, observationAreaRecordStatus } from "./observationArea";
import { buildIntakeDraft } from "./intakeDraft";
import { vehicleContextDetails } from "./vehicleContext";
import { normalizeServiceRecords, serviceRecordRows, serviceRecordStatus } from "./serviceRecord";
import { normalizeInspectionComparison, normalizeInspectionComparisons, inspectionComparisonStatus } from "./inspectionComparison";
import type { InspectionComparison } from "../types/inspectionComparison";
import { buildDiagnosticReportSection } from "./diagnosticReportHtml";
import { photoRelationshipDescription, photoRelationshipOrUnknown, photoRelationshipScopeDescription } from "./photoRelationship";
import { buildPhotoReviewState, photoReviewStatusLabel } from "./photoReview";
import { normalizeJobInspectionReportScope } from "../services/jobInspectionHandoff";

export const MAX_INSPECTION_REPORT_HTML_BYTES = 64 * 1024 * 1024;

const escape = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const prose = (value: unknown): string => `<p>${escape(value)}</p>`;
const list = (values: readonly string[], empty = "None recorded."): string => values.length ? `<ul>${values.map((value) => `<li>${escape(value)}</li>`).join("")}</ul>` : prose(empty);
const details = (rows: readonly (readonly [string, unknown])[]): string => `<dl>${rows.map(([label, value]) => `<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`).join("")}</dl>`;
const words = (value: string): string => value.replaceAll("_", " ");

/** MIME, base64 syntax and raster signatures are checked again at the export boundary. */
function rasterImage(value: string): boolean {
  if (value.length > MAX_INSPECTION_REPORT_HTML_BYTES) throw new Error("The HTML report exceeds the 64 MiB limit. Export fewer scans or smaller photos.");
  const match = /^data:image\/(png|jpeg|webp);base64,/.exec(value);
  if (!match) return false;
  const encoded = value.slice(match[0].length);
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  const byteLength = encoded.length / 4 * 3 - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
  const head = atob(encoded.slice(0, 64));
  const tail = atob(encoded.slice(Math.max(0, encoded.length - 24)));
  const byte = (index: number) => head.charCodeAt(index);
  if (match[1] === "png") {
    return byteLength >= 45 && head.startsWith("\x89PNG\r\n\x1a\n") && head.slice(12, 16) === "IHDR"
      && [16, 20].every((start) => [0, 1, 2, 3].some((offset) => byte(start + offset) > 0))
      && tail.endsWith("\0\0\0\0IEND\xaeB\x60\x82");
  }
  if (match[1] === "jpeg") return byteLength >= 4 && head.startsWith("\xff\xd8\xff") && tail.endsWith("\xff\xd9");
  const declaredLength = (byte(4) + byte(5) * 256 + byte(6) * 65536 + byte(7) * 16777216) + 8;
  return byteLength >= 20 && head.startsWith("RIFF") && head.slice(8, 12) === "WEBP"
    && ["VP8 ", "VP8L", "VP8X"].includes(head.slice(12, 16)) && declaredLength === byteLength;
}

function validBox(box: VisualFocusBox | undefined): box is VisualFocusBox {
  return Boolean(box && [box.x, box.y, box.width, box.height].every(Number.isFinite)
    && box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0
    && box.x + box.width <= 1.000001 && box.y + box.height <= 1.000001);
}

function scanPhotos(scan: Lookup): ScanPhoto[] {
  return scan.photos !== undefined ? scan.photos : [{ id: "photo-1", label: "overview", ...scan.frame }];
}

type ScanEntry = { scan: Lookup; anchor: string; number: number; photos: ScanPhoto[] };
type Outline = { box: VisualFocusBox; label: string; target?: string; map?: boolean };

function vehicleRows(scan: Lookup, options: InspectionReportOptions): [string, string][] {
  return contextRows(scan.vehicleContext, options);
}

function contextRows(context: VehicleContext | undefined, options: InspectionReportOptions): [string, string][] {
  // An allowlist prevents the display helper's optional shop fields from leaking into an export.
  const safe: VehicleContext = {
    year: context?.year, make: context?.make, model: context?.model, engine: context?.engine,
    mileage: context?.mileage, mileageUnit: context?.mileageUnit, modifications: context?.modifications,
    confirmedFields: context?.confirmedFields, symptom: context?.symptom,
    ...(options.includeVin ? { vin: context?.vin } : {}),
    ...(options.includePrivateNotes ? { notes: context?.notes } : {}),
  };
  return vehicleContextDetails(safe).filter(([label]) => options.includeVin || label !== "VIN")
    .map(([label, value]) => [label === "Symptoms" ? "User-supplied complaint — unconfirmed, not visual evidence" : label, value]);
}

const CSS = `
:root{color-scheme:light;font:16px/1.55 system-ui,sans-serif;color:#17232d;background:#eef2f4}
*{box-sizing:border-box}body{margin:0}main{max-width:1080px;margin:auto;padding:24px}h1,h2,h3,h4{line-height:1.2}h1{font-size:2rem}h2{margin-top:0}h3{margin-top:1.6rem}h4{margin-bottom:.5rem}p,li,dd,figcaption{overflow-wrap:anywhere;white-space:pre-wrap}a{color:#075b8b;overflow-wrap:anywhere}section,article,header{background:white;border:1px solid #cad4da;border-radius:8px;padding:24px;margin:20px 0}article{padding:18px}nav ul{display:flex;flex-wrap:wrap;gap:8px 24px;padding-left:20px}dl{display:grid;grid-template-columns:minmax(140px,1fr) 3fr;gap:6px 16px}dt{font-weight:600}dd{margin:0}figure{margin:18px 0}img{display:block;max-width:100%;height:auto}.stage{position:relative;display:inline-block;max-width:100%;vertical-align:top}.outlines{position:absolute;inset:0;pointer-events:none;display:none}.outline{position:absolute;border:3px solid #00c4dd;box-shadow:0 0 0 1px #111;pointer-events:auto}.outline.map{border-color:#ffd900}.outline span{position:absolute;left:0;top:0;background:#17232d;color:white;padding:1px 5px;font-size:12px;white-space:normal}.outline-toggle:checked~.stage .outlines{display:block}.outline-toggle{margin:0 8px 12px 0}.toggle-label{display:inline-block;margin-bottom:12px}.stage{display:block;width:fit-content}figcaption{font-size:.9rem;margin-top:8px}.badge{display:inline-block;padding:2px 8px;background:#e6edf2;border-radius:4px;font-size:.9rem}.warning{border-left:5px solid #9a5800;background:#fff5dc;padding:12px}.safety{border:2px solid #a01e20;padding:14px;background:#fff1f0}.muted{color:#465764}.component-list{padding-left:26px}.component-list>li{padding:14px 0;border-bottom:1px solid #d9e0e5}.component-list h3{display:inline;margin:0 8px 0 0}.crop-note{border-left:3px solid #007c91;padding-left:12px}footer{padding:24px 0;font-size:.9rem} :target{scroll-margin-top:16px;outline:2px solid #0783a8;outline-offset:4px}
.diagnostic-source{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.85rem}.diagnostic-frame h6{font-size:.95rem;margin:0}.diagnostic-fault h5,.diagnostic-photo h5{font-size:1rem}
@media(max-width:600px){main{padding:12px}section,header,article{padding:16px}dl{grid-template-columns:1fr;gap:2px}dd{margin-bottom:10px}h1{font-size:1.6rem}}
@media print{:root{font-size:10pt;background:white}main{max-width:none;padding:0}section,article,header{border-radius:0;padding:12px;break-inside:auto}h2,h3,h4{break-after:avoid}figure,.safety{break-inside:avoid}a{color:inherit}nav{display:none}.outline-toggle,.toggle-label{display:none}.outlines{display:block}img{max-height:230mm;object-fit:contain}.stage img{max-height:none}footer{border-top:1px solid #aaa}}
`;

export function getInspectionReportFilename(snapshot: InspectionReportSnapshot): string {
  const date = /^\d{4}-\d{2}-\d{2}/.exec(snapshot.createdAt)?.[0] ?? "undated";
  return `deepspec-inspection-${date}.html`;
}

/** Produces a static, offline document. It never fetches assets or serializes a whole lookup. */
export function buildInspectionReportHtml(snapshot: InspectionReportSnapshot, options: InspectionReportOptions = DEFAULT_INSPECTION_REPORT_OPTIONS): string {
  if (snapshot.version !== 1) throw new Error("Unsupported inspection report snapshot version.");
  const entries: ScanEntry[] = [];
  const byId = new Map<string, ScanEntry>();
  for (const scan of snapshot.scans) {
    if (byId.has(scan.id)) continue;
    const entry = { scan, anchor: `scan-${entries.length + 1}`, number: entries.length + 1, photos: scanPhotos(scan) };
    entries.push(entry);
    byId.set(scan.id, entry);
  }
  let jobScopeHtml = "";
  if (snapshot.jobScope !== undefined) {
    const job = normalizeJobInspectionReportScope(snapshot.jobScope, snapshot);
    if (!job) throw new Error("The job report scope is invalid or inconsistent with its saved scans. Prepare the report again.");
    const jobIds = (ids: string[]) => ids.length ? `<ul>${ids.map((id) => {
      const entry = byId.get(id);
      return `<li>${entry ? `<a href="#${entry.anchor}">${escape(id)}</a>` : escape(id)}</li>`;
    }).join("")}</ul>` : prose("None.");
    jobScopeHtml = `<section id="job-report-scope"><h2>Selected-overview job report scope</h2>
      ${prose(`Selected overview: ${job.rootLookupId}. This is not an all-job report. It contains this overview and the evidence reached through its existing links.`)}
      ${prose("Job membership does not establish that scans show the same vehicle or component. Unlinked job scans were not silently added. Scope lists describe this prepared snapshot; unavailable photos and other gaps remain listed separately.")}
      <h3>Included job scans</h3>${jobIds(job.includedJobScanIds)}
      <h3>Available job scans excluded from this snapshot</h3>${jobIds(job.excludedJobScanIds)}
      <h3>Unavailable job scans</h3>${jobIds(job.unavailableJobScanIds)}
      <h3>Linked scans outside the job</h3>${jobIds(job.outsideJobScanIds)}
      <h3>Conflicting job associations</h3>${job.conflictingJobScanIds.length ? `<ul>${job.conflictingJobScanIds.map((id) => `<li>${escape(id)}: ${byId.has(id) ? "Included through linked evidence; job association conflicts." : "Not included; job association conflicts."}</li>`).join("")}</ul>` : prose("None.")}
      <h3>Different saved vehicle fields</h3>${job.vehicleDifferences.length ? `<ul>${job.vehicleDifferences.map((row) => `<li>${escape(row.lookupId)}: ${escape(row.fields.join(", "))}. No vehicle identity was inferred.</li>`).join("")}</ul>` : prose("No differences were listed for the saved fields compared. This does not establish vehicle identity.")}</section>`;
  }
  const missing = snapshot.missing.map((issue) => {
    const entry = byId.get(issue.lookupId);
    const subject = entry ? `Scan ${entry.number}` : `Unavailable scan ${issue.lookupId}`;
    return `${subject}${issue.photoId ? ` / photo ${issue.photoId}` : ""}${issue.selectionName ? ` / ${issue.selectionName}` : ""}: ${issue.message}`;
  });
  const missingSet = new Set(missing);
  const noteMissing = (message: string) => { if (!missingSet.has(message)) { missing.push(message); missingSet.add(message); } };
  const photoAnchor = (entry: ScanEntry, photoId: string) => {
    const index = entry.photos.findIndex((photo) => photo.id === photoId);
    return index >= 0 ? `${entry.anchor}-photo-${index + 1}` : undefined;
  };
  const photoLink = (lookupId: string, photoId: string): string => {
    const entry = byId.get(lookupId);
    const anchor = entry && photoAnchor(entry, photoId);
    if (anchor) return `<a href="#${anchor}">${escape(photoId)}</a>`;
    noteMissing(`Photo ${photoId} in scan ${lookupId} is unavailable in this snapshot.`);
    return `${escape(photoId)} <span class="badge">Unavailable</span>`;
  };
  const serviceHistory = (lookupId: string, anchor: string): string => {
    const logs = snapshot.serviceLogs?.filter((log) => log.lookupId === lookupId);
    if (!logs?.length) return prose("Human measurement, repair and follow-up history was not collected in this snapshot.");
    if (logs.length !== 1) throw new Error("This report contains duplicate human-service histories. Prepare it again.");
    const log = logs[0];
    const records = normalizeServiceRecords(log.records, lookupId);
    if (!records) throw new Error("Human-service records could not be read safely. Prepare the report again; the saved records are unchanged.");
    const recordAnchor = (id: string) => `${anchor}-service-${records.findIndex((record) => record.id === id) + 1}`;
    const recordLink = (id: string) => `<a href="#${recordAnchor(id)}">${escape(id)}</a>`;
    const scopeNote = log.cloudChecked
      ? "Cloud human-service history was checked. Available records are listed below; any unavailable device history is identified under Missing or unavailable evidence. This does not mean both sources were available."
      : "Cloud history was not verified for this snapshot. Only records from successfully read sources are listed below; unavailable sources may contain additional entries.";
    return `${prose(scopeNote)}${prose("These entries are human-reported evidence, separate from AI estimates. A completed repair does not establish its cause, resolve a symptom, clear a safety instruction or certify function. A symptom not observed during one check may recur.")}
      ${records.length ? records.map((record, index) => {
        const status = serviceRecordStatus(record, records);
        const followUps = record.kind === "repair" ? records.filter((other) => other.kind === "follow_up" && other.relatedRecordIds.includes(record.id) && serviceRecordStatus(other, records) === "current") : [];
        const requestedMeasurement = record.version === 2 ? `<section class="requested-measurement"><h5>Requested-measurement evidence</h5>
          ${prose("The saved request and AI-answer fingerprint are historical receipt data. The AI answer was not reverified here; its fingerprint does not establish that the request is correct, that a measurement was performed, or that a finding is resolved.")}
          ${record.requestedMeasurement.references.length ? `<ul>${record.requestedMeasurement.references.map((side) => {
            const proofs = snapshot.serviceEvidence?.filter((proof) => proof.lookupId === record.lookupId && proof.recordId === record.id && proof.photoId === side.photoId) ?? [];
            const entry = byId.get(side.lookupId), photos = entry?.photos.filter((photo) => photo.id === side.photoId) ?? [];
            const available = photos.length === 1 && rasterImage(photos[0].imageBase64);
            const reported = proofs.length === 1 ? proofs[0].status : "verification_unavailable";
            const proof = reported === "unchanged" && !available ? "missing_photo" : reported;
            const verified = proof === "unchanged";
            const message = verified ? "The embedded original bytes and saved context match this receipt."
              : proof === "source_changed" ? "The current photo or saved context differs from this receipt; it is not verified historical evidence."
                : proof === "missing_photo" ? "The cited original is missing or unavailable in this snapshot."
                  : "The cited original was not verified for this snapshot.";
            if (!verified) noteMissing(`Requested measurement ${record.id}, photo ${side.photoId}: ${message}`);
            return `<li>${verified ? "Verified receipt original" : "Current saved image reference — not verified as the receipt original"}: ${photoLink(side.lookupId, side.photoId)}. ${escape(message)}</li>`;
          }).join("")}</ul>` : prose("No original photos were cited by this request, so no original-image binding is verified. Human-selected supporting photos below do not retroactively become AI citations.")}
          ${prose("Photo verification does not verify a reading, instrument, method, service limit, vehicle identity or repair outcome. Corrections and retractions retain the historical request.")}</section>` : "";
        return `<article id="${recordAnchor(record.id)}" class="service-record"><h4>Human ${escape(words(record.kind))} ${index + 1} <span class="badge">${escape(words(status))}</span></h4>
          ${status === "conflicting_correction" ? prose("Conflicting corrections remain in this history. Neither alternative has been chosen automatically.") : ""}
          ${details(serviceRecordRows(record, { includeVin: options.includeVin, includePrivateNotes: options.includePrivateNotes }))}
          ${requestedMeasurement}
          ${record.supersedesId ? `<p>Corrects or retracts earlier entry: ${recordLink(record.supersedesId)}.</p>` : ""}
          <p>${record.version === 2 ? "Human-recorded photo references — current saved images" : "Supporting originals"}: ${record.photoIds.length ? record.photoIds.map((id) => photoLink(lookupId, id)).join(", ") : "No photo references recorded."}</p>
          ${record.kind === "follow_up" && record.relatedRecordIds.length ? `<p>Related entries: ${record.relatedRecordIds.map(recordLink).join(", ")}.</p>` : ""}
          ${record.kind === "repair" && ["completed", "attempted"].includes(record.status) ? followUps.length ? `<p>Separately recorded follow-up: ${followUps.map((followUp) => recordLink(followUp.id)).join(", ")}. Review its result and conditions.</p>` : prose("Follow-up not recorded for this repair entry. Its outcome remains unverified.") : ""}</article>`;
      }).join("") : prose("No human measurement, repair or follow-up entries were found in the sources successfully read for this snapshot.")}`;
  };
  const assetValidation = new Map<string, boolean>();
  const usedAssets = new Map<string, string>();
  let imageCharacters = 0;
  const imageMarkup = (data: string, anchor: string, label: string, outlines: Outline[] = []): string => {
    let valid = assetValidation.get(data);
    if (valid === undefined) { valid = rasterImage(data); assetValidation.set(data, valid); }
    if (!valid) { noteMissing(`${label}: original or cutout image unavailable, invalid, or not an embedded supported raster.`); return prose("Image unavailable in this report."); }
    // The image is embedded once; repeated associations point to those exact saved bytes.
    const existing = usedAssets.get(data);
    if (existing && !outlines.length) return `<p>Same saved image: <a href="#${existing}">view embedded image</a>.</p>`;
    usedAssets.set(data, existing ?? anchor);
    imageCharacters += data.length;
    if (imageCharacters > MAX_INSPECTION_REPORT_HTML_BYTES) throw new Error("The HTML report exceeds the 64 MiB limit. Export fewer scans or smaller photos.");
    const boxes = outlines.map(({ box, label: outlineLabel, target, map }) => {
      const style = `left:${box.x * 100}%;top:${box.y * 100}%;width:${box.width * 100}%;height:${box.height * 100}%`;
      return target ? `<a class="outline${map ? " map" : ""}" href="#${target}" style="${style}" aria-label="${escape(outlineLabel)}"><span>${escape(outlineLabel)}</span></a>`
        : `<span class="outline" style="${style}"><span>${escape(outlineLabel)}</span></span>`;
    }).join("");
    return `${outlines.length ? `<input class="outline-toggle" type="checkbox" id="${anchor}-outlines"><label class="toggle-label" for="${anchor}-outlines">Show saved outlines (included when printed)</label>` : ""}<div class="stage"><img src="${escape(data)}" alt="${escape(label)}">${outlines.length ? `<div class="outlines">${boxes}</div>` : ""}</div>`;
  };
  const mapRecord = snapshot.map;
  const map = mapRecord?.document;
  const hasBoundOverview = map?.version === 3 || map?.version === 4;
  const mapOverviewStatus = hasBoundOverview ? snapshot.mapOverviewEvidence?.status ?? "verification_unavailable" : "legacy_unverified";
  const mapOverviewVerified = hasBoundOverview && mapOverviewStatus === "unchanged";
  const mapOverviewMessage = mapOverviewStatus === "legacy_unverified"
    ? "This legacy map has no recorded overview fingerprint. Historical map outlines are unverified and hidden; its components, notes, statuses and links are retained."
    : mapOverviewStatus === "unchanged" ? "The embedded overview image matches the map's recorded source fingerprint and timestamps."
      : mapOverviewStatus === "source_changed" ? "The embedded overview differs from the map's recorded source. Map outlines are hidden; its components, notes, statuses and links are retained."
        : mapOverviewStatus === "missing_photo" ? "The bound overview image is missing. Map outlines are hidden; its components, notes, statuses and links are retained."
          : "Verification of the embedded overview is unavailable. Map outlines are hidden; its components, notes, statuses and links are retained.";
  if (map && !mapOverviewVerified) noteMissing(mapOverviewMessage);
  const componentStatus = (component: ComponentMapComponent) => ({ needs_view: "Needs a view", inspected: "Inspected — user review, not a safety certification", not_visible: "Not visible" })[component.status];
  const mapHtml = map && mapRecord ? `<section id="component-map"><h2>Component map</h2>
    <p>Saved component labels, notes and statuses are user-maintained. AI suggestions are starting points; no component is automatically inspected. Suggestions may repeat the same part when their identity is uncertain. This is not a complete engine inspection.</p>
    <div class="${mapOverviewVerified ? "map-source-verified" : "warning"}" aria-label="Map overview verification">${prose(mapOverviewMessage)}</div>
    <p>Overview verification checks file identity only. The saved image may itself be a crop; matching bytes do not prove a capture angle, vehicle identity, correct component label or condition. Linked photo groups are ID-based associations; their historical image bytes are not bound by this overview verification. Bound linked photos are checked separately below; an ID-only legacy group has no recorded historical fingerprint.</p>
    ${details([["Components", map.components.length], ["Local revision", mapRecord.localRevision], ["Acknowledged cloud revision", mapRecord.cloudRevision ?? "None"], ["Last acknowledged local revision", mapRecord.syncedLocalRevision]])}
    ${mapRecord.cloudRevision === null || mapRecord.syncedLocalRevision !== mapRecord.localRevision || mapRecord.syncAttempt ? prose("Local map changes are not acknowledged as saved to the cloud.") : prose("This local map revision is acknowledged as saved to the cloud.")}
    ${mapRecord.syncAttempt ? prose(`A cloud save attempt for local revision ${mapRecord.syncAttempt.localRevision} is unacknowledged (started ${mapRecord.syncAttempt.startedAt}).`) : ""}
    ${mapRecord.conflict ? `<p class="warning">Unresolved cloud conflict at cloud revision ${escape(mapRecord.conflict.revision)}. This report contains the local map shown above; the competing cloud map is not merged or included.</p>` : ""}
    <p>Overview: ${photoLink(map.overview.lookupId, map.overview.photoId)}. ${mapOverviewVerified ? "Numbered outlines identify saved regions on this verified overview image; they are not verified component boundaries." : "Saved regions are retained without drawing them on an unverified overview."} Unboxed and not-visible components remain in the index.</p>
    <ol class="component-list">${map.components.map((component, index) => {
      // Distinct link IDs are distinct saved associations, even with identical photos.
      const groups = component.scanGroups;
      return `<li id="component-${index + 1}"><h3>${escape(component.label)}</h3><span class="badge">${escape(componentStatus(component))}</span>
        ${component.suggestedLocation ? prose(`AI-suggested location — unverified: ${component.suggestedLocation.text}. This text does not establish an outline or confirm the component's identity. User notes and marked areas are separate.`) : ""}
        ${component.reviewedAt ? prose(`User review recorded: ${component.reviewedAt}`) : prose("No explicit user review recorded.")}
        ${component.notes ? prose(component.notes) : prose("No component notes recorded.")}
        ${component.region ? `<p>Saved region source: ${photoLink(map.overview.lookupId, component.region.sourcePhotoId)}${component.status === "not_visible" ? "; outline hidden because the component is marked not visible." : !mapOverviewVerified ? "; outline hidden because its overview source is unverified." : validBox(component.region.box) ? "." : "; invalid outline omitted."}</p>` : prose("No region outline saved.")}
        ${groups.length ? `<ul>${groups.map((group, groupIndex) => {
          const entry = byId.get(group.lookupId);
          const binding = map.version === 4 ? group.binding : undefined;
          const history = binding ? `${details([["User-reported relationship at linking", photoRelationshipDescription(binding.photoRelationship)]])}
            ${prose("Matching linked files do not prove the same physical part, vehicle, capture angle or condition. Saved images may themselves be crops.")}
            ${binding.photoRelationship !== "same_part_or_area" ? prose("For this independent or unknown relationship, supplied vehicle and complaint context is scoped to Photo 1. Linking this group does not establish a shared vehicle or component.") : ""}`
            : prose("Legacy linked group — historical image bytes, labels and relationship were not recorded at linking. Current saved images are not verified historical evidence.");
          const linkedPhotos = group.photoIds.map((photoId) => {
            const historical = binding?.photos.find((photo) => photo.photoId === photoId);
            const checks = snapshot.linkedPhotoEvidence?.filter((item) => item.componentId === component.id && item.linkId === group.linkId
              && item.lookupId === group.lookupId && item.photoId === photoId);
            const evidence = checks?.length === 1 ? checks[0] : undefined;
            const currentPhoto = entry?.photos.find((photo) => photo.id === photoId);
            const status = !binding ? "legacy_unverified" : evidence?.status ?? "verification_unavailable";
            const verified = Boolean(binding && historical && status === "unchanged" && currentPhoto && rasterImage(currentPhoto.imageBase64));
            const description = verified ? "Verified linked photo — the embedded bytes and timestamps match the historical binding."
              : !binding ? "Legacy photo — historical source unverified."
                : status === "source_changed" ? "Historical linked photo changed — current bytes or timestamps differ. The current image is not substituted as the historical evidence."
                  : status === "missing_photo" ? "Historical linked photo missing — another image is not substituted."
                    : "Historical linked photo verification unavailable — the current image is not asserted to match the historical evidence.";
            if (binding && !verified) noteMissing(`Component ${index + 1}, photo group ${groupIndex + 1}, photo ${photoId}: ${description}`);
            const metadata = historical ? details([["Photo ID at linking", photoId], ["Label at linking", words(historical.label)]]) : details([["Referenced photo ID", photoId]]);
            const changedMetadata = evidence?.currentMetadataChanged ? `${prose("Current label or relationship differs from the context recorded at linking; the historical context above is retained.")}
              ${details([["Current saved label", currentPhoto ? words(currentPhoto.label) : "Unavailable"], ["Current user-reported relationship", entry ? photoRelationshipDescription(entry.scan.photoRelationship) : "Unavailable"]])}` : "";
            return `<li class="linked-photo-evidence">${metadata}${prose(description)}${changedMetadata}<p>${verified ? "Verified linked image" : "Current saved image reference — not verified as historical evidence"}: ${photoLink(group.lookupId, photoId)}</p></li>`;
          }).join("");
          return `<li class="linked-photo-group">Photo group ${groupIndex + 1}: ${entry ? `<a href="#${entry.anchor}">Scan ${entry.number}</a> (current saved scan record)` : "Scan unavailable"}${history}<ul>${linkedPhotos}</ul></li>`;
        }).join("")}</ul>` : prose("No linked component photo groups.")}</li>`;
    }).join("")}</ol></section>` : `<section id="component-map"><h2>Component map</h2>${prose("No component map is included in this snapshot.")}</section>`;

  const scansHtml = entries.map((entry) => {
    const { scan, anchor, number, photos } = entry;
    const result = scan.result;
    const draft = buildIntakeDraft(scan);
    const assessment = normalizeConditionAssessment(result?.conditionAssessment, photos.map((photo) => photo.id));
    const areaLogs = snapshot.observationAreaLogs?.filter((log) => log.lookupId === scan.id);
    const areaRecords = areaLogs?.length === 1 ? normalizeObservationAreaRecords(areaLogs[0].records, scan.id) : undefined;
    if (areaLogs?.length && !areaRecords) noteMissing(`Scan ${number}: human observation-area history is invalid or ambiguous.`);
    const areaStatus = (recordId: string) => {
      const record = areaRecords?.find((item) => item.id === recordId);
      const photoId = record?.binding.reference.photoId;
      if (!photos.some((photo) => photo.id === photoId && rasterImage(photo.imageBase64))) return undefined;
      const checks = snapshot.observationAreaEvidence?.filter((item) => item.lookupId === scan.id && item.recordId === recordId && item.photoId === photoId);
      return checks?.length === 1 ? checks[0] : undefined;
    };
    const areaAnchor = (recordId: string) => `${anchor}-human-area-${recordId}`;
    if (result?.conditionAssessment && !assessment) noteMissing(`Scan ${number}: invalid condition-assessment references were omitted; other saved findings remain below.`);
    const reviewState = buildPhotoReviewState(result?.photoReview, photos.map((photo, index) => ({ id: photo.id, label: `Photo ${index + 1}` })), Boolean(result));
    if (reviewState.invalid) noteMissing(`Scan ${number}: the saved per-photo review could not be validated; its claims were omitted.`);
    const photoReviewHtml = `<div class="photo-review" id="${anchor}-photo-review"><h3>Per-photo AI review</h3>
      ${prose("AI-reported review is not human verification or proof of condition, function, safety, fitment or agreement.")}
      ${prose(reviewState.sourceMessage)}
      ${prose(reviewState.message)}
      <ol class="photo-review-rows">${reviewState.rows.map((row, index) => {
        return `<li id="${anchor}-photo-review-${index + 1}"><p>${escape(row.label)}: ${photoLink(scan.id, row.id)}</p>
          ${details([["AI review status", photoReviewStatusLabel(row.status)]])}${row.summary ? prose(row.summary) : ""}</li>`;
      }).join("")}</ol>
      <h4>Cross-photo disagreements — AI-reported, unconfirmed</h4>
      ${prose(reviewState.disagreementMessage)}
      ${reviewState.review?.disagreements.length ? `<ol class="photo-review-disagreements">${reviewState.review.disagreements.map((item, index) => `<li id="${anchor}-photo-disagreement-${index + 1}">
        ${prose(item.description)}<p>Referenced saved images: ${item.photoIds.map((id) => photoLink(scan.id, id)).join(", ")}</p>
        ${details([["Targeted next evidence", item.nextEvidence.request], ["Purpose", item.nextEvidence.purpose]])}</li>`).join("")}</ol>`
        : ""}</div>`;
    const selections = (scan.isolatedObjects ?? []).map((object) => ({ name: object.name, box: object.focusBox, mode: object.focusMode, data: object.isolatedImageBase64, correctedAt: object.correctedAt, primary: object.primary }));
    if ((scan.focusBox || scan.isolatedImageBase64) && !selections.some((selection) => selection.primary && JSON.stringify(selection.box) === JSON.stringify(scan.focusBox) && selection.data === (scan.isolatedImageBase64 ?? "") && selection.mode === scan.focusMode)) {
      selections.unshift({ name: "Primary selection", box: scan.focusBox!, mode: scan.focusMode, data: scan.isolatedImageBase64 ?? "", correctedAt: undefined, primary: true });
    }
    const photosHtml = photos.map((photo, photoIndex) => {
      const anchorId = photoAnchor(entry, photo.id)!;
      const outlines: Outline[] = [];
      assessment?.observations.forEach((observation, index) => {
        const area = observation.areas?.find((item) => item.photoId === photo.id);
        if (area) outlines.push({ box: { ...area.rectangle, confidence: 0 }, label: `AI area ${index + 1} — unverified`, target: `${anchor}-observation-${index + 1}` });
      });
      areaRecords?.forEach((record, index) => {
        if (record.kind === "mark" && record.binding.reference.photoId === photo.id && observationAreaRecordStatus(record, areaRecords) === "current"
          && areaStatus(record.id)?.status === "unchanged") outlines.push({ box: { ...record.rectangle, confidence: 0 }, label: `Human area ${index + 1}`, target: areaAnchor(record.id), map: true });
      });
      if (photoIndex === 0) selections.forEach((selection, index) => { if (validBox(selection.box)) outlines.push({ box: selection.box, label: `Selection ${index + 1}`, target: `${anchor}-selection-${index + 1}` }); });
      if (mapOverviewVerified && map?.overview.lookupId === scan.id) map.components.forEach((component, index) => {
        if (component.status !== "not_visible" && component.region?.sourcePhotoId === photo.id && validBox(component.region.box)) outlines.push({ box: component.region.box, label: `Component ${index + 1}`, target: `component-${index + 1}`, map: true });
      });
      return `<figure id="${anchorId}"><h4>Photo ${photoIndex + 1} — ${escape(words(photo.label))}</h4>${imageMarkup(photo.imageBase64, anchorId, `Scan ${number}, saved photo ${photoIndex + 1}`, outlines)}<figcaption>Saved source image: ${escape(photo.id)}. Captured: ${escape(photo.capturedAt)}. This report embeds the saved pixels without further cropping or annotation; the saved image itself may be a crop. Optional outlines are separate display overlays.</figcaption></figure>`;
    }).join("");
    const selectionsHtml = selections.map((selection, index) => {
      const selectionAnchor = `${anchor}-selection-${index + 1}`;
      const corrected = Boolean(selection.correctedAt);
      const crop = selection.mode === "crop" || corrected;
      const boxDescription = photos[0] && validBox(selection.box) ? `<a href="#${photoAnchor(entry, photos[0].id)}">View selection ${index + 1} on the first original photo</a>.` : "No valid saved source photo and outline are available.";
      if (!validBox(selection.box)) noteMissing(`Scan ${number}, ${selection.name}: no valid source outline is available.`);
      return `<article id="${selectionAnchor}"><h4>${escape(selection.name)}${selection.primary ? " — primary selection" : ""}</h4>
        ${crop ? `<p class="crop-note">${corrected ? "User-corrected crop selection" : "Crop selection"}. This is a rectangular selection, not a segmentation mask. ${boxDescription}</p>${corrected ? prose(`Selection corrected: ${selection.correctedAt}`) : ""}`
          : selection.mode === "full_frame" ? prose("Full-frame selection; no isolated mask is asserted.")
            : `${prose(selection.mode === "mask" ? "Saved segmentation-mask cutout; it is an image derivative, not condition evidence on its own." : "Saved cutout; its masking method was not recorded.")}<p>${boxDescription}</p>${selection.data ? imageMarkup(selection.data, selectionAnchor, `Scan ${number}, cutout for ${selection.name}`) : prose("No cutout image saved or available.")}`}
        ${prose("Selection geometry applies only to the first original photo. Changing the selection does not revise the AI findings.")}</article>`;
    }).join("");
    const assessmentHtml = assessment ? `<h3>Photo-linked AI condition observations</h3>${prose("AI-suggested areas are unverified pointers on the cited saved photos, not damage boundaries, measurements or confirmed findings. No area is invented when the model supplied none. The saved answer does not include a provider-time image checksum.")}<ol>${assessment.observations.map((observation, index) => `<li id="${anchor}-observation-${index + 1}">${escape(observation.text)}${observation.regionLabel ? `<p>Textual region: ${escape(observation.regionLabel)} (not a geometric annotation).</p>` : ""}<p>Photos: ${observation.photoIds.map((id) => photoLink(scan.id, id)).join(", ")}</p><p>${observation.areas?.length ? `AI-suggested outline ${index + 1} — unverified, on: ${observation.areas.map((area) => photoLink(scan.id, area.photoId)).join(", ")}.` : "No AI area was returned."}</p></li>`).join("")}</ol>
      <h4>Possible causes — unconfirmed hypotheses</h4>${assessment.possibleCauses.length ? `<ul>${assessment.possibleCauses.map((cause) => `<li>${escape(cause.text)}<p>Based on observations: ${cause.observationIds.map((id) => { const index = assessment.observations.findIndex((observation) => observation.id === id); return `<a href="#${anchor}-observation-${index + 1}">${index + 1}</a>`; }).join(", ")}</p></li>`).join("")}</ul>` : prose("No possible cause recorded.")}
      <h4>Unknowns and limits</h4>${list(assessment.unknowns, "No explicit unknowns recorded; absence is not confirmation of condition or safety.")}
      ${assessment.nextEvidence ? `<h4>Priority next evidence</h4>${details([["Request type", words(assessment.nextEvidence.kind)], ["Request", assessment.nextEvidence.request], ["Purpose", assessment.nextEvidence.purpose]])}${assessment.nextEvidence.photoIds?.length ? `<p>Related photos: ${assessment.nextEvidence.photoIds.map((id) => photoLink(scan.id, id)).join(", ")}</p>` : ""}` : ""}` : prose("No valid structured condition assessment was saved. Legacy AI findings, if present, are listed below.");
    const areaHistory = areaRecords ? `${prose("Human areas are saved on this device only; other devices may have additional history. A mark is a review pointer, not a confirmed diagnosis or measured boundary. Corrections and retractions retain earlier entries.")}${areaRecords.length ? areaRecords.map((record, index) => {
      const status = observationAreaRecordStatus(record, areaRecords), evidence = areaStatus(record.id), bound = record.binding;
      return `<article id="${areaAnchor(record.id)}"><h4>Human area ${index + 1} — ${escape(status)}</h4>${details([["Recorded", record.recordedAt], ["Historical observation", bound.observation.text], ["Observation ID", bound.observation.id], ["Historical AI answer fingerprint", bound.analysisSha256], ["Historical analysis attempt", bound.analysisAttemptId ?? "Not recorded"], ["Original file fingerprint", bound.reference.sha256], ["Original dimensions", `${bound.reference.width} × ${bound.reference.height}`], ["Notes", record.notes || "None recorded"], ...(record.kind === "mark" ? [["Rectangle on original (x, y, width, height; 0–1)", `${record.rectangle.x}, ${record.rectangle.y}, ${record.rectangle.width}, ${record.rectangle.height}`] as const] : [])])}
        <p>Referenced photo: ${photoLink(scan.id, bound.reference.photoId)}.</p>${prose(evidence?.status === "unchanged" ? "The embedded original bytes and saved photo context match this human record." : "The historical original is unavailable, changed or unverified. This record's outline is not placed on the current photo.")}
        ${prose(evidence?.analysisMatches ? "The saved AI answer matches the historical answer fingerprint. This does not confirm the AI claim." : "The originating AI answer differs from the current answer or could not be checked. This human record keeps its historical claim.")}
        ${record.supersedesId ? `<p>Corrects <a href="#${areaAnchor(record.supersedesId)}">the retained earlier entry</a>: ${escape(record.correctionReason)}.</p>` : ""}${status === "conflicting" ? prose("Conflicting entries are retained. No active outline was chosen.") : ""}</article>`;
    }).join("") : prose("No human observation-area entries were found on this device.")}` : prose("Human observation-area history was not collected or could not be read. No empty history is assumed.");
    const human = scan.inspection;
    const relationshipScope = photos.length > 1 ? photoRelationshipScopeDescription(scan.photoRelationship, result ? result.modelRun?.pipelineVersion : null) : undefined;
    return `<section id="${anchor}"><h2>Scan ${number}: ${escape(draft.name)}</h2>${details([["Identity source", draft.identitySource], ["Record created", scan.createdAt], ["Saved/creation timestamp", scan.provenance.savedAt], ["Stored capture mode (may be defaulted on cloud restore)", words(scan.provenance.captureMode)], ["Stored analysis source (may be defaulted on cloud restore)", words(scan.provenance.analysisSource)], ["Cloud revision", scan.cloudRevision ?? "Not recorded"], ["Cloud save status", scan.cloudSave?.status ?? "Not recorded"]])}
      <p class="muted">Cloud scan records used by this report do not retain capture/analysis provenance. These stored fields can contain defaults and do not prove camera use or model execution, including after a cloud record was saved on this device. Separately recorded model-run details are shown below when available.</p>
      ${scan.correction ? details([["User-corrected label — not independently verified", scan.correction]]) : ""}
      <h3>Saved vehicle and complaint${photos.length > 1 && photoRelationshipOrUnknown(scan.photoRelationship) !== "same_part_or_area" ? " — Photo 1" : ""}</h3>${details(vehicleRows(scan, options))}
      <p class="muted">Vehicle confirmation is self-reported. These details do not establish part fitment or condition.</p>
      <h3>Saved image evidence</h3>${details([[photoRelationshipOrUnknown(scan.photoRelationship) === "unknown" ? "Photo relationship" : "User-reported photo relationship", photoRelationshipDescription(scan.photoRelationship)]])}
      ${relationshipScope ? prose(relationshipScope) : ""}
      ${photosHtml}${selections.length ? `<h3>Saved selections and cutouts</h3>${selectionsHtml}` : prose("No isolated selections or cutouts saved.")}
      ${photoReviewHtml}
      ${result ? `<h3>AI identification — unverified</h3>${details([["Suggested identity", result.partName], ["Confidence", result.confidence], ["Category", words(result.scanCategory)], ["What it does", result.whatItDoes], ["Fitment", result.fitmentConfidence ? words(result.fitmentConfidence) : "Not established"], ["Confirmation needed", result.confirmationNeed ? words(result.confirmationNeed) : "Not recorded"]])}
        ${result.modelRun ? details([["Provider", result.modelRun.provider], ["Model", result.modelRun.model], ["Prompt version", result.modelRun.promptVersion ?? "Not recorded"], ["Pipeline version", result.modelRun.pipelineVersion ?? "Not recorded"], ["Analyzed", scan.analyzedAt ?? "Not recorded"], ["OCR used", result.modelRun.ocrUsed ? "Yes" : "No"], ...(result.modelRun.fallbackReason ? [["Provider fallback", result.modelRun.fallbackReason] as const] : [])]) : prose("Model provenance not recorded.")}
        <div class="${result.isSafetyCritical || result.safetyTriage === "needs_professional" ? "safety" : "warning"}"><h4>${result.isSafetyCritical || result.safetyTriage === "needs_professional" ? "Safety action — preserve before further use" : "Saved next action"}</h4>${prose(result.nextAction || "No specific action recorded.")}${details([["Safety triage", words(result.safetyTriage)], ["Safety-critical flag", result.isSafetyCritical ? "Yes" : "No — not a safety clearance"]])}</div>
        ${assessmentHtml}<h4>Other saved AI visible observations</h4>${list(result.visibleObservations)}
        ${result.evidenceRegions.length ? `<h4>Textual evidence regions — no geometric claim</h4>${result.evidenceRegions.map((region) => details([["Label", region.label], ["Observation", region.observation], ["Region", region.regionLabel]])).join("")}` : ""}
        <h4>AI concerns — unconfirmed</h4>${list(result.concerns)}<h4>Other saved AI evidence</h4>${list(result.evidence)}
        <h4>Additional evidence requested</h4>${list(result.requiredNextEvidence ?? [])}
        ${result.candidateMatches.length ? `<h4>Alternative AI identities</h4>${result.candidateMatches.map((candidate) => details([["Candidate", candidate.partName], ["Confidence", candidate.confidence], ["Reason", candidate.reason]])).join("")}` : ""}
        ${result.measurements?.length ? `<h4>AI-reported dimensions — not human measurements</h4>${prose("These are model outputs, including estimates or interpretations of markings. No human measurement is inferred.")}${result.measurements.map((measurement) => details([["Dimension", measurement.label], ["AI-reported value", `${measurement.valueMm} mm`], ["Method", words(measurement.method)], ["AI confidence", measurement.confidence], ["Caveat", measurement.caveat]])).join("")}` : ""}
        ${result.sourceLinks.length ? `<h4>Saved reference links — not independently verified by this export</h4><ul>${result.sourceLinks.map((source) => `<li>${escape(source.label)} (${escape(source.sourceType)}): ${escape(source.url)}</li>`).join("")}</ul>` : ""}` : `<h3>Analysis unavailable</h3>${prose(scan.errorMessage || "No AI result is saved for this scan.")}`}
      <h3>Human observation areas and corrections</h3>${areaHistory}
      <h3>Human inspection — self-reported record</h3>${human ? details([["Confirmed part name", human.confirmedPartName || "Not recorded"], ["Part number", human.partNumber || "Not recorded"], ["Identity evidence", human.identityEvidence || "Not recorded"], ["Visible condition", words(human.visibleCondition)], ["Visible condition notes", human.visibleNotes || "None recorded"], ["Functional test status", words(human.functionalStatus)], ["Functional test notes", human.functionalNotes || "None recorded"], ["Inspection recorded", human.inspectedAt]]) : prose("No human inspection or functional test recorded. Photos do not establish function.")}
      <h3>Human measurements, repairs and follow-up history</h3>${serviceHistory(scan.id, anchor)}
      <h3>Checks still needed</h3>${list(draft.checks)}
      ${options.includePrivateNotes && scan.notes ? `<h3>Private scan notes — included by request</h3>${prose(scan.notes)}` : ""}</section>`;
  }).join("");

  const unavailableServiceIds = [...new Set((snapshot.serviceLogs ?? []).map((log) => log.lookupId).filter((id) => !byId.has(id)))];
  const unavailableServiceHtml = unavailableServiceIds.length ? `<section id="unavailable-service-history"><h2>Retained human history for unavailable scans</h2>
    ${prose("These entries were saved independently of scan images. Their original scan metadata and photos are unavailable in this snapshot. The recorded statements and references remain intact; no other image or AI result has been substituted.")}
    ${unavailableServiceIds.map((id, index) => `<section id="unavailable-service-${index + 1}"><h3>Unavailable scan: ${escape(id)}</h3>${serviceHistory(id, `unavailable-service-${index + 1}`)}</section>`).join("")}</section>` : "";
  const unavailableAreaLogs = (snapshot.observationAreaLogs ?? []).filter((log) => !byId.has(log.lookupId));
  const unavailableAreaIds = new Set<string>();
  const unavailableAreaHtml = unavailableAreaLogs.length ? `<section id="unavailable-area-history"><h2>Retained observation areas for unavailable scans</h2>${prose("Device history is retained without its original scan or photos. No outline is placed on another image, and no current AI finding is substituted.")}${unavailableAreaLogs.map((log, logIndex) => {
    const records = normalizeObservationAreaRecords(log.records, log.lookupId);
    if (!records || unavailableAreaIds.has(log.lookupId)) throw new Error("Retained observation-area histories are invalid or ambiguous. Prepare the report again.");
    unavailableAreaIds.add(log.lookupId);
    const recordAnchor = (id: string) => `unavailable-area-${logIndex + 1}-${id}`;
    return `<section><h3>Unavailable scan: ${escape(log.lookupId)}</h3>${records.map((record) => `<article id="${recordAnchor(record.id)}"><h4>Human area — ${escape(observationAreaRecordStatus(record, records))}</h4>${details([["Recorded", record.recordedAt], ["Historical observation", record.binding.observation.text], ["Observation ID", record.binding.observation.id], ["Photo ID", record.binding.reference.photoId], ["Historical AI answer fingerprint", record.binding.analysisSha256], ["Original file fingerprint", record.binding.reference.sha256], ["Original dimensions", `${record.binding.reference.width} × ${record.binding.reference.height}`], ["Notes", record.notes || "None recorded"], ...(record.kind === "mark" ? [["Rectangle on unavailable original (x, y, width, height; 0–1)", `${record.rectangle.x}, ${record.rectangle.y}, ${record.rectangle.width}, ${record.rectangle.height}`] as const] : [])])}${record.supersedesId ? `<p>Corrects <a href="#${recordAnchor(record.supersedesId)}">the retained earlier entry</a>: ${escape(record.correctionReason)}.</p>` : ""}</article>`).join("") || prose("No area entries found on this device.")}</section>`;
  }).join("")}</section>` : "";
  const comparisonIds = new Set<string>();
  const renderedComparisons = new Map<string, { record: InspectionComparison; anchor: string }>();
  const comparisonsHtml = `<section id="dated-comparisons"><h2>Dated visual comparisons</h2>
    ${prose("Comparisons preserve human observations and both photo references. They do not measure rust growth, establish remaining material thickness, confirm a cause or repair outcome, or clear an existing safety instruction. Added/saved dates do not establish when an imported photo was taken.")}
    ${snapshot.comparisonLogs ? snapshot.comparisonLogs.map((log, logIndex) => {
      if (comparisonIds.has(log.lookupId)) throw new Error("This report contains duplicate comparison histories. Prepare it again.");
      comparisonIds.add(log.lookupId);
      const records = normalizeInspectionComparisons(log.records, log.lookupId);
      if (!records) throw new Error("Dated comparisons could not be read safely. Prepare the report again.");
      if (!records.length) return "";
      const anchor = (id: string) => `comparison-${logIndex + 1}-${records.findIndex((record) => record.id === id) + 1}`;
      return `${prose(log.cloudChecked ? "Cloud comparison history was checked; unavailable sources are listed under Missing evidence." : "Cloud comparison history was not verified. Additional entries may exist.")}${records.map((record) => {
        renderedComparisons.set(`${record.lookupId}/${record.id}`, { record, anchor: anchor(record.id) });
        const status = inspectionComparisonStatus(record, records);
        const guide = record.version === 2 ? record.requestedEvidence : null;
        const requestedPhoto = guide ? `<section class="requested-photo-receipt"><h4>Saved photo request — AI suggestion</h4>
          ${details([["Request kind", words(guide.kind)], ["Request", guide.request], ["Why it was requested", guide.purpose], ["Originating analysis reference", guide.analysisAttemptId ?? "Not recorded"], ["Originating answer fingerprint — recorded, not reverified", record.version === 2 ? record.analysisSha256 : ""]])}
          <p>Cited photo IDs — links show current saved images, not verified historical evidence: ${guide.photoIds.length ? guide.photoIds.map((id) => photoLink(record.earlier.lookupId, id)).join(", ") : "No photos were cited."}</p>
          ${prose("This saved receipt records collected photos, not an answered or resolved finding. The human review and source availability are listed separately below. Only the selected reference and follow-up carry comparison bindings; other cited photos and the originating AI advice are not certified by this report.")}</section>`
          : prose("No requested-photo guide was recorded for this comparison.");
        const views = (["earlier", "current"] as const).map((sideName) => {
          const side = record[sideName];
          const entry = byId.get(side.lookupId);
          const photo = entry?.photos.find((candidate) => candidate.id === side.photoId);
          const checks = snapshot.comparisonEvidence?.filter((item) => item.lookupId === record.lookupId && item.recordId === record.id && item.side === sideName);
          const verified = checks?.length === 1 && checks[0].status === "unchanged";
          const label = sideName === "earlier" ? "Reference" : "Follow-up";
          let picture = prose("Historical original unavailable or unverified. Another image has not been substituted.");
          if (verified && photo && rasterImage(photo.imageBase64)) {
            imageCharacters += photo.imageBase64.length;
            if (imageCharacters > MAX_INSPECTION_REPORT_HTML_BYTES) throw new Error("The HTML report exceeds the 64 MiB limit. Export fewer comparisons or smaller photos.");
            const a = record.alignment;
            const transform = sideName === "current" ? `transform:translate(${a.offsetX * 100}%,${a.offsetY * 100}%) rotate(${a.rotation}deg) scale(${a.scale});` : "";
            picture = `<div class="comparison-viewport" style="aspect-ratio:4/3;overflow:hidden;background:#eef2f4"><img src="${escape(photo.imageBase64)}" alt="${escape(`${label} original for ${record.subject}`)}" style="${transform}width:100%;height:100%;object-fit:contain"></div><p>Unaligned original: ${photoLink(side.lookupId, side.photoId)}.</p>`;
          } else noteMissing(`Comparison ${record.id}, ${label.toLowerCase()} photo ${side.photoId}: historical evidence was not verified.`);
          return `<figure style="min-width:0"><h4>${label}</h4>${picture}${details([["Photo", `${side.photoId} — ${words(side.photoLabel)}`], ["Observation date — user reported", side.observedOn ?? "Unknown"], ["Photo added", side.photoAddedAt], ["Scan saved", side.scanSavedAt], ["Saved analysis reference", side.analysisAttemptId ?? "Not recorded"]])}
            <h4>Vehicle context saved with this comparison</h4>${details(contextRows(side.vehicleContext ?? undefined, options))}</figure>`;
        }).join("");
        return `<article id="${anchor(record.id)}" class="comparison-record"><h3>${escape(record.subject)} <span class="badge">${escape(words(status))}</span></h3>
          ${status === "conflicting_correction" ? prose("Conflicting corrections are retained. No alternative was chosen automatically.") : ""}
          ${requestedPhoto}
          ${details([["Recorded", record.recordedAt], ["Same vehicle — human confirmation", record.relationship.sameVehicle ? "Yes, self-reported" : "Unconfirmed"], ["Component relationship — human statement", words(record.relationship.component)], ["Identity basis", record.relationship.basis || "Not recorded"], ["Viewpoint", words(record.conditions.angle)], ["Lighting", words(record.conditions.lighting)], ["Surface, cleaning and intervening work", record.conditions.surfaceNotes || "Not recorded"], ["Human observation", words(record.observation.outcome)], ["Observation notes", record.observation.notes || "None recorded"]])}
          ${record.conditions.angle !== "similar" || record.conditions.lighting !== "similar" ? '<p class="warning">Viewing conditions differ or are unknown. An apparent difference may come from the photographs.</p>' : ""}
          ${!record.earlier.observedOn || !record.current.observedOn ? prose("At least one observation date is unknown. Added/saved timestamps cannot establish the chronology of a visual change.") : ""}
          ${record.supersedesId ? `<p>Corrects <a href="#${anchor(record.supersedesId)}">the retained earlier entry</a>: ${escape(record.correctionReason)}.</p>` : ""}
          ${prose(`Follow-up display alignment: rotation ${record.alignment.rotation}°, proportional scale ${record.alignment.scale}, horizontal offset ${record.alignment.offsetX * 100}%, vertical offset ${record.alignment.offsetY * 100}%. Display alignment is not a measurement or proof that views are comparable; unaligned originals remain linked.`)}
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:20px">${views}</div></article>`;
      }).join("")}`;
    }).join("") || prose("No comparison entries were found in the sources successfully read for this snapshot.") : prose("Comparison history was not collected in this snapshot.")}</section>`;
  const requestedHistory = snapshot.requestedEvidenceHistory;
  let requestedHistoryHtml = `<section id="requested-photo-history"><h2>Requested-photo follow-ups</h2>${prose("Requested-photo reverse history was not collected in this snapshot. Additional follow-ups may exist.")}</section>`;
  if (requestedHistory) {
    if (requestedHistory.originLookupId !== snapshot.rootLookupId || requestedHistory.source !== "device" || requestedHistory.cloudSearched !== false
      || typeof requestedHistory.complete !== "boolean" || !Array.isArray(requestedHistory.records)
      || !Number.isSafeInteger(requestedHistory.scannedBuckets) || requestedHistory.scannedBuckets < 0
      || (requestedHistory.reason !== undefined && typeof requestedHistory.reason !== "string")) throw new Error("Requested-photo history could not be read safely. Prepare the report again.");
    const seen = new Set<string>();
    const links = requestedHistory.records.map((value) => {
      const record = normalizeInspectionComparison(value);
      if (!record || record.version !== 2) throw new Error("A requested-photo history entry is invalid. Prepare the report again.");
      const key = `${record.lookupId}/${record.id}`, rendered = renderedComparisons.get(key);
      if (record.earlier.lookupId !== snapshot.rootLookupId || seen.has(key)
        || !rendered || JSON.stringify(record) !== JSON.stringify(rendered.record)) throw new Error("A requested-photo history entry is missing or inconsistent. Prepare the report again.");
      seen.add(key);
      return `<li><a href="#${rendered.anchor}">${escape(record.requestedEvidence.request)}</a> — recorded ${escape(record.recordedAt)}; human outcome: ${escape(words(record.observation.outcome))}.</li>`;
    });
    requestedHistoryHtml = `<section id="requested-photo-history"><h2>Requested-photo follow-ups</h2>
      ${prose("This reverse search covers device history only. Cloud follow-ups were not searched; additional history may exist in cloud or on other devices.")}
      ${requestedHistory.complete ? prose("The device history search completed within its limits.") : `<p class="warning">${escape(requestedHistory.reason ?? "The device history search was incomplete. Additional requested-photo entries may exist.")}</p>`}
      ${links.length ? `<p>${links.length} retained requested-photo entr${links.length === 1 ? "y" : "ies"}, including any corrections. Collection does not establish that the request was answered or the finding resolved.</p><ul>${links.join("")}</ul>`
        : prose(requestedHistory.complete ? "No requested-photo entries were found in the device history read for this snapshot." : "No entries were found in the device history that could be read; this is not a complete search.")}</section>`;
  }
  const diagnosticsHtml = buildDiagnosticReportSection(snapshot, options, photoLink);
  if (!byId.has(snapshot.rootLookupId)) noteMissing("The requested overview scan is unavailable in this snapshot.");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; object-src 'none'"><title>DeepSpec mechanic handoff</title><style>${CSS}</style></head><body><main>
    <header><h1>Mechanic handoff</h1>${prose(`Snapshot created: ${snapshot.createdAt}`)}${prose(`${entries.length} saved scan${entries.length === 1 ? "" : "s"}; ${map?.components.length ?? 0} mapped components. This is a saved evidence report, not a diagnosis or certification of condition, fitment, function or safety.`)}
    <p>AI observations, possible causes and human records are labeled separately. Linked photos are not assumed to show the same part or vehicle unless that relationship was established by the user. Original images may contain identifying details or embedded metadata.</p>
    ${prose(`VIN ${options.includeVin ? "included where saved" : "excluded from dedicated fields"}; private scan and vehicle notes ${options.includePrivateNotes ? "included where saved" : "excluded"}. Component notes, human inspection notes, human-area notes, service-record notes, saved evidence requests and extracted diagnostic text are included as inspection evidence and may contain identifiers. Saved customer, plate, job, inspector and service-recorder identity fields and chat transcripts are excluded. Original diagnostic files ${options.includeDiagnosticOriginals ? "are included unredacted and may contain identifiers regardless of the VIN setting" : "and original filenames are excluded"}.`)}
    <nav aria-label="Report navigation"><ul>${jobScopeHtml ? '<li><a href="#job-report-scope">Job report scope</a></li>' : ""}<li><a href="#component-map">Component map</a></li>${entries.map((entry) => `<li><a href="#${entry.anchor}">Scan ${entry.number}</a></li>`).join("")}${unavailableServiceIds.length ? '<li><a href="#unavailable-service-history">Retained history for unavailable scans</a></li>' : ""}<li><a href="#missing-evidence">Missing evidence</a></li></ul></nav></header>
    ${jobScopeHtml}${mapHtml}${scansHtml}${unavailableServiceHtml}${unavailableAreaHtml}${requestedHistoryHtml}${comparisonsHtml}${diagnosticsHtml}<section id="missing-evidence"><h2>Missing or unavailable evidence</h2>${list(missing, "No missing evidence was reported for this snapshot. This does not establish completeness of an inspection.")}</section>
    <footer>Static report with embedded raster images. No scripts or remote assets. Saved outlines are display overlays, not changes to original pixels. Human-service entries retain corrections and retractions; they are self-reported records, not independently verified repairs or measurements.</footer></main></body></html>`;
  if (html.length > MAX_INSPECTION_REPORT_HTML_BYTES || new TextEncoder().encode(html).byteLength > MAX_INSPECTION_REPORT_HTML_BYTES) throw new Error("The HTML report exceeds the 64 MiB limit. Export fewer scans or smaller photos.");
  return html;
}
