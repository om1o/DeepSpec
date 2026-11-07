import type { InspectionReportOptions, InspectionReportSnapshot } from "../types/inspectionReport";
import { diagnosticAssociationStatus, normalizeDiagnosticBundle } from "./diagnosticAssociation";
import { diagnosticEntryIds, diagnosticSourceText, parseDiagnosticText } from "./diagnosticReport";
import { vehicleContextDetails } from "./vehicleContext";

const escape = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const prose = (value: unknown) => `<p>${escape(value)}</p>`;
const rows = (values: readonly (readonly [string, unknown])[]) => `<dl>${values.map(([label, value]) => `<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`).join("")}</dl>`;
const words = (value: string) => value.replaceAll("_", " ");
const fail = (): never => { throw new Error("Diagnostic evidence is inconsistent or unreadable. Prepare the report again; saved originals are unchanged."); };

/** Static rendering of the collector's verified snapshot; no network calls or interpretation by a model. */
export function buildDiagnosticReportSection(snapshot: InspectionReportSnapshot, options: InspectionReportOptions,
  photoLink: (lookupId: string, photoId: string) => string): string {
  const seen = new Set<string>();
  const logs = snapshot.diagnosticLogs;
  const content = logs?.map((log, logIndex) => {
    if (seen.has(log.lookupId)) fail();
    seen.add(log.lookupId);
    const bundle = normalizeDiagnosticBundle(log.bundle, log.lookupId);
    if (!bundle || log.parsed.length !== bundle.documents.length) return fail();
    const prefix = `diagnostic-${logIndex + 1}`;
    const documentAnchor = (id: string) => `${prefix}-document-${bundle.documents.findIndex((item) => item.id === id) + 1}`;
    const associationAnchor = (id: string) => `${prefix}-association-${bundle.associations.findIndex((item) => item.id === id) + 1}`;
    const documents = bundle.documents.map((document, documentIndex) => {
      const parsedEntries = log.parsed.filter((entry) => entry.id === document.id);
      const original = diagnosticSourceText(document);
      // Never trust cached derived fields over the preserved source.
      const report = parseDiagnosticText(original);
      if (parsedEntries.length !== 1 || JSON.stringify(parsedEntries[0].report) !== JSON.stringify(report)) fail();
      const entryIds = new Set(diagnosticEntryIds(report));
      if (bundle.associations.some((record) => record.documentId === document.id && record.entryIds.some((id) => !entryIds.has(id)))) fail();
      const anchor = documentAnchor(document.id);
      const line = (n: number) => `Source line ${n}`;
      const controllers = report.controllers.map((controller) => `<article id="${anchor}-${controller.id}" class="diagnostic-controller">
        <h4>Controller ${escape(controller.address)}: ${escape(controller.name)}</h4>
        ${rows([["Source lines", `${controller.startLine}–${controller.endLine}`], ["Declared fault count", controller.declaredFaultCount ?? "Unknown"],
          ["Parsed fault entries", controller.faults.length], ["Source fault statement", controller.faultCoverage === "explicitly_absent" ? "Source explicitly reports no fault codes; this is not proof of mechanical condition." : words(controller.faultCoverage)]])}
        ${controller.faults.map((fault) => `<article id="${anchor}-${fault.id}" class="diagnostic-fault"><h5>${escape(fault.vendorCode)}${fault.genericCode ? ` / ${escape(fault.genericCode)}` : ""}: ${escape(fault.description)}</h5>
          ${prose(`Source lines ${fault.startLine}–${fault.endLine}. Codes and status text are reported by the scanner; they do not establish a failed part.`)}
          <ul>${fault.details.map((detail) => `<li>${escape(line(detail.line))}: ${escape(detail.text)}</li>`).join("")}</ul>
          ${fault.freezeFrames.map((frame) => `<section id="${anchor}-${frame.id}" class="diagnostic-frame"><h6>Freeze frame — ${escape(line(frame.line))}</h6><ul>${frame.readings.map((reading) => `<li id="${anchor}-${reading.id}"><strong>${escape(reading.label || "Unlabeled source reading")}</strong>: ${escape(reading.rawValue)} <span class="muted">(${escape(line(reading.line))})</span></li>`).join("")}</ul></section>`).join("")}</article>`).join("")}
        ${controller.readiness.length ? `<h5>Readiness text from source</h5><ul>${controller.readiness.map((entry) => `<li>${escape(line(entry.line))}: ${escape(entry.text)}</li>`).join("")}</ul>` : ""}</article>`).join("");
      return `<article id="${anchor}" class="diagnostic-document"><h3>Diagnostic report ${documentIndex + 1}</h3>
        ${rows([["Imported into DeepSpec", document.importedAt], ["Source format", words(report.format)], ["Reported software version", report.sourceVersion ?? "Unknown"],
          ["Parsing coverage", report.coverage === "complete" ? "Recognized sections parsed; this does not establish scan or vehicle completeness." : words(report.coverage)],
          ["Original bytes", document.byteLength], ["Source encoding", document.encoding], ["Saved source SHA-256", document.sha256],
          ["Reported scan time", report.reportedTime ?? "Unknown"], ["Reported mileage", report.reportedMileage ?? "Unknown"],
          ...(options.includeVin ? [["VIN reported by scanner — unconfirmed", report.reportedVin ?? "Unknown"]] as [string, string][] : [])])}
        ${prose("Scan and freeze-frame times are source text. Their timezone, clock accuracy and relationship to the photo dates have not been inferred. Repeated readings are retained in source order, with their original precision and units.")}
        ${report.warnings.length ? `<div class="warning"><h4>Parsing limitations</h4><ul>${report.warnings.map((warning) => `<li>${warning.line ? `${escape(line(warning.line))}: ` : ""}${escape(warning.message)}</li>`).join("")}</ul></div>` : ""}
        ${report.inventory.length ? `<h4>Scanner inventory statements</h4><ul>${report.inventory.map((entry) => `<li>${escape(line(entry.line))}: ${escape(entry.text)}</li>`).join("")}</ul>` : ""}
        ${controllers || prose("No structured controller entries are available. This does not mean the vehicle has no fault codes.")}
        ${options.includeDiagnosticOriginals ? `<div class="warning">Original diagnostic text is included unredacted. It may contain VINs, registration plates, names or other identifiers even when saved VIN fields are excluded.</div>
          ${rows([["Original filename", document.fileName], ["Original MIME label", document.mime || "Not supplied"]])}
          <p><a download="diagnostic-original-${logIndex + 1}-${documentIndex + 1}.txt" href="data:application/octet-stream;base64,${document.sourceBase64}">Download unchanged diagnostic original</a></p>
          <details><summary>Original diagnostic text</summary><pre class="diagnostic-source">${escape(original)}</pre></details>` : prose("Original text and filename are excluded from this export. The saved original remains available in DeepSpec. Extracted text and human notes may still contain identifying information.")}</article>`;
    }).join("");
    const associations = bundle.associations.map((record, index) => {
      const status = diagnosticAssociationStatus(record, bundle.associations);
      const sourceAnchor = documentAnchor(record.documentId);
      const photos = record.photos.map((photo) => {
        const checks = snapshot.diagnosticEvidence?.filter((entry) => entry.lookupId === record.lookupId && entry.recordId === record.id && entry.photoId === photo.photoId) ?? [];
        const verified = checks.length === 1 && checks[0].status === "unchanged";
        const context = photo.vehicleContext ? { ...photo.vehicleContext, ...(options.includeVin ? {} : { vin: undefined }) } : undefined;
        return `<section class="diagnostic-photo"><h5>Associated photo: ${escape(photo.photoId)}</h5>
          ${verified ? `<p>Verified against this snapshot: ${photoLink(photo.lookupId, photo.photoId)}.</p>` : prose("Historical photo or context is unavailable, changed or unverified. No current photo is substituted as this association's evidence.")}
          ${rows([["Saved photo label", words(photo.photoLabel)], ["Saved photo SHA-256", photo.sha256], ["Photo added", photo.photoAddedAt], ["Scan saved", photo.scanSavedAt],
            ["User-reported observation date", photo.observedOn ?? "Not recorded"], ["Saved dimensions", `${photo.width} × ${photo.height}`],
            ...vehicleContextDetails(context).filter(([label]) => options.includeVin || label !== "VIN")])}</section>`;
      }).join("");
      return `<article id="${associationAnchor(record.id)}" class="diagnostic-association"><h4>Human association ${index + 1}: ${escape(record.subject)} <span class="badge">${escape(words(status))}</span></h4>
        ${status === "conflicting_correction" ? prose("Conflicting corrections remain. Neither alternative was selected automatically.") : ""}
        ${rows([["Recorded", record.recordedAt], ["Vehicle relationship — human assertion", words(record.vehicleRelationship)], ["Basis", record.basis || "Not supplied"], ["Human notes", record.notes || "None"], ["Source SHA-256", record.sourceSha256]])}
        <p>Scanner evidence: ${record.entryIds.length ? record.entryIds.map((id) => `<a href="#${sourceAnchor}-${id}">${escape(id)}</a>`).join(", ") : `<a href="#${sourceAnchor}">Whole diagnostic report</a>`}.</p>
        ${record.supersedesId ? `<p>Corrects <a href="#${associationAnchor(record.supersedesId)}">earlier association</a>: ${escape(record.correctionReason)}.</p>` : ""}${photos}</article>`;
    }).join("");
    return `<section id="${prefix}"><h3>Saved scan ${escape(log.lookupId)}</h3>
      ${prose(log.cloudChecked ? "Cloud diagnostic history was checked. Any unavailable device history is listed under missing evidence." : "Cloud diagnostic history was not verified. Available saved evidence is included; other sources may contain additional records.")}
      ${documents || prose("No diagnostic reports were found in the sources successfully read for this snapshot.")}
      ${associations ? `<h3>Human links between reports and photos</h3>${associations}` : prose("No human links between diagnostic reports and photos were recorded.")}</section>`;
  }).join("");
  return `<section id="diagnostic-reports"><h2>Diagnostic reports and photo associations</h2>
    ${prose("Scanner-reported evidence and human associations are separate from AI findings. Linking a code to a photo does not establish the same vehicle, a failed component, a cause, or a verified repair.")}
    ${content || prose(logs ? "No diagnostic histories were collected." : "Diagnostic history was not collected in this snapshot.")}</section>`;
}
