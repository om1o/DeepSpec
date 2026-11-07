import type { DiagnosticController, DiagnosticDocument, DiagnosticEncoding, DiagnosticFault, ParsedDiagnosticReport } from "../types/diagnosticReport";

export const MAX_DIAGNOSTIC_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_LINES = 20_000;
const MAX_LINE_LENGTH = 4096;
const MAX_CONTROLLERS = 256;
const MAX_FAULTS = 2000;
const MAX_FRAME_READINGS = 512;
const MAX_FAULT_DETAILS = 256;
const TERMINATOR = /^End-{3,}(?:\([^\r\n]*\)-*)?\s*$/;
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const SAFE_ID = /^(?!\.{1,2}$)[A-Za-z0-9._:-]{1,160}$/;
const DOCUMENT_KEYS = new Set(["version", "id", "lookupId", "importedAt", "fileName", "mime", "byteLength", "sha256", "encoding", "sourceBase64"]);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const encodingValid = (value: unknown): value is DiagnosticEncoding => value === "utf-8" || value === "windows-1252";
const timeValid = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  && !value.startsWith("0000-") && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
const fileNameValid = (value: unknown): value is string => typeof value === "string" && value.length <= 255 && Boolean(value.trim()) && /\.txt$/i.test(value) && !/[\\/\p{Cc}]/u.test(value);
const mimeValid = (value: unknown): value is string => value === "" || value === "text/plain" || value === "application/octet-stream";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(binary);
}

function decode(bytes: Uint8Array, encoding: DiagnosticEncoding): string {
  let decoded: string;
  try { decoded = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { throw new Error(encoding === "utf-8" ? "This file is not valid UTF-8. Choose Windows-1252 only if that is the report's encoding, then try again." : "This file cannot be decoded as Windows-1252."); }
  // Reject binary/control data, while retaining tabs, newlines and original bytes.
  for (const character of decoded) {
    const code = character.charCodeAt(0);
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || (code >= 127 && code <= 159)) throw new Error("Import a plain-text report. Binary data and unsupported control characters cannot be parsed.");
  }
  return decoded;
}

/** Synchronous structural validation; SHA-256 is checked by verifyDiagnosticDocument. */
export function normalizeDiagnosticDocument(value: unknown, lookupId?: string): DiagnosticDocument | null {
  if (!object(value) || Object.keys(value).some((key) => !DOCUMENT_KEYS.has(key)) || value.version !== 1
    || typeof value.id !== "string" || !UUID.test(value.id) || typeof value.lookupId !== "string" || !SAFE_ID.test(value.lookupId)
    || (lookupId !== undefined && value.lookupId !== lookupId) || !timeValid(value.importedAt) || !fileNameValid(value.fileName) || !mimeValid(value.mime)
    || !Number.isSafeInteger(value.byteLength) || (value.byteLength as number) < 1 || (value.byteLength as number) > MAX_DIAGNOSTIC_SOURCE_BYTES
    || typeof value.sha256 !== "string" || !/^[a-f\d]{64}$/i.test(value.sha256) || !encodingValid(value.encoding)
    || typeof value.sourceBase64 !== "string" || value.sourceBase64.length !== 4 * Math.ceil((value.byteLength as number) / 3)) return null;
  try {
    const binary = atob(value.sourceBase64);
    if (binary.length !== value.byteLength || btoa(binary) !== value.sourceBase64) return null;
    decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)), value.encoding);
  } catch { return null; }
  return { version: 1, id: value.id.toLowerCase(), lookupId: value.lookupId, importedAt: value.importedAt, fileName: value.fileName,
    mime: value.mime, byteLength: value.byteLength as number, sha256: value.sha256.toLowerCase(), encoding: value.encoding, sourceBase64: value.sourceBase64 };
}

export function diagnosticSourceBytes(document: DiagnosticDocument): Uint8Array {
  const checked = normalizeDiagnosticDocument(document);
  if (!checked) throw new Error("This diagnostic document has invalid metadata, encoding or source bytes. Restore the original text file.");
  return Uint8Array.from(atob(checked.sourceBase64), (character) => character.charCodeAt(0));
}

export function diagnosticSourceText(document: DiagnosticDocument): string {
  return decode(diagnosticSourceBytes(document), document.encoding);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readFile(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function") return new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(new Uint8Array(reader.result)) : reject(new Error("The report file could not be read. Try selecting it again."));
    reader.onerror = () => reject(new Error("The report file could not be read. Try selecting it again."));
    reader.onabort = () => reject(new Error("Reading the report file was cancelled."));
    reader.readAsArrayBuffer(file);
  });
}

export async function createDiagnosticDocument(file: File, lookupId: string, encoding: DiagnosticEncoding = "utf-8", id: string = crypto.randomUUID()): Promise<DiagnosticDocument> {
  if (typeof lookupId !== "string" || !SAFE_ID.test(lookupId) || !UUID.test(id)) throw new Error("Select a saved scan before importing diagnostic evidence.");
  if (!encodingValid(encoding)) throw new Error("Choose UTF-8 or Windows-1252 for this text report.");
  if (!fileNameValid(file.name) || !mimeValid(file.type)) throw new Error("Select a plain-text diagnostic .txt report, not an HTML or PDF document.");
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_DIAGNOSTIC_SOURCE_BYTES) throw new Error("Choose a nonempty diagnostic text file no larger than 2 MiB.");
  const bytes = await readFile(file);
  if (bytes.length !== file.size || bytes.length > MAX_DIAGNOSTIC_SOURCE_BYTES) throw new Error("The report file size changed while reading. Select the original file again.");
  parseDiagnosticText(decode(bytes, encoding));
  return { version: 1, id: id.toLowerCase(), lookupId, importedAt: new Date().toISOString(), fileName: file.name, mime: file.type,
    byteLength: bytes.length, sha256: await sha256(bytes), encoding, sourceBase64: bytesToBase64(bytes) };
}

export async function verifyDiagnosticDocument(document: DiagnosticDocument): Promise<ParsedDiagnosticReport> {
  const bytes = diagnosticSourceBytes(document);
  if (await sha256(bytes) !== document.sha256.toLowerCase()) throw new Error("This diagnostic source no longer matches its saved fingerprint. Restore the original file; it has not been accepted as unchanged evidence.");
  return parseDiagnosticText(decode(bytes, document.encoding));
}

/** Ordered, line-based IDs are stable for this immutable source, not across reports. */
export function diagnosticEntryIds(parsed: ParsedDiagnosticReport): string[] {
  return parsed.controllers.flatMap((controller) => [controller.id, ...controller.faults.flatMap((fault) => [fault.id, ...fault.freezeFrames.flatMap((frame) => [frame.id, ...frame.readings.map((reading) => reading.id)])])]);
}

export function parseDiagnosticText(text: string): ParsedDiagnosticReport {
  // Decoded Windows-1252 text can occupy more UTF-8 bytes than its original file.
  if (text.length > MAX_DIAGNOSTIC_SOURCE_BYTES) throw new Error("The report exceeds the 2 MiB text limit.");
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length > MAX_LINES) throw new Error("The report exceeds the 20,000-line parsing limit. No truncated report was accepted.");
  if (lines.some((line) => line.length > MAX_LINE_LENGTH)) throw new Error("A report line exceeds 4,096 characters. No truncated report was accepted.");
  const firstAddress = lines.findIndex((line) => /^\s*Address\s+[\dA-Fa-f]{2,4}:/.test(line));
  const header = lines.slice(0, firstAddress < 0 ? lines.length : firstAddress);
  const versionLine = header.find((line) => /^VCDS Version:/.test(line));
  const sourceVersion = versionLine?.match(/^VCDS Version:\s*(\S+)/)?.[1] ?? null;
  const result: ParsedDiagnosticReport = { parser: "vcds-autoscan-text-v1", format: "unrecognized", coverage: "unrecognized", sourceVersion,
    exampleVersionMatched: sourceVersion === "22.4.0.1", reportedTime: null, reportedVin: null, reportedMileage: null, inventory: [], controllers: [], warnings: [], lineCount: lines.length };
  // A single-controller saved-code report has a similar banner but no scan/chassis header.
  if (!header.some((line) => /^VCDS -- /.test(line)) || !versionLine || !header.some((line) => /^Scan:/.test(line))) {
    result.warnings.push({ message: "Unrecognized format. Only English VCDS Auto-Scan text is parsed; single-controller reports, HTML, PDF and other scanner formats are unsupported. The original remains available." });
    return result;
  }
  result.format = "vcds_autoscan"; result.coverage = "complete";
  const warn = (message: string, line?: number) => { result.coverage = "incomplete"; result.warnings.push({ message, ...(line === undefined ? {} : { line }) }); };
  if (!result.exampleVersionMatched) warn("This source version does not match the documented 22.4.0.1 example. Current-release and other-version compatibility is unverified; review the original.");
  if (!header.some((line) => /^Chassis Type:\s*\S/.test(line))) warn("The Auto-Scan chassis header is missing or malformed.");
  result.reportedTime = header.find((line) => /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),/.test(line)) ?? null;
  if (!result.reportedTime) warn("The reported scan time is missing or unrecognized; no time or timezone was inferred.");
  for (let index = 0; index < header.length; index++) {
    const line = header[index];
    const vin = line.match(/^VIN:\s*(\S+)/); if (vin) result.reportedVin = vin[1];
    const mileage = line.match(/(?:^|\s)Mileage:\s*(.*?)(?:\s{2,}(?:Repair Order|License Plate):|$)/); if (mileage) result.reportedMileage = mileage[1].trim() || null;
    if (/^\s*[\dA-Fa-f]{2,4}-.*-- Status:/.test(line)) result.inventory.push({ text: line, line: index + 1 });
  }
  let controller: DiagnosticController | undefined;
  let fault: DiagnosticFault | undefined;
  let frame: DiagnosticFault["freezeFrames"][number] | undefined;
  let totalFaults = 0;
  let terminated = firstAddress < 0 && lines.some((line) => TERMINATOR.test(line.trim()));
  const finishFault = (endLine: number) => { if (fault) fault.endLine = Math.max(fault.startLine, endLine); fault = undefined; frame = undefined; };
  const finishController = (endLine: number) => {
    finishFault(endLine);
    if (!controller) return;
    controller.endLine = Math.max(controller.startLine, endLine);
    if (controller.declaredFaultCount === null) warn("The controller has no recognized fault count or explicit no-fault statement.", controller.startLine);
    else if (controller.declaredFaultCount !== controller.faults.length) warn("The declared fault count does not match the parsed entries. Review this controller's original text.", controller.startLine);
    if (controller.faults.length) {
      if (controller.faultCoverage === "explicitly_absent") warn("This controller contains both a no-fault statement and fault entries.", controller.startLine);
      controller.faultCoverage = "present";
    }
    controller = undefined;
  };
  for (let index = firstAddress < 0 ? header.length : firstAddress; index < lines.length; index++) {
    const raw = lines[index], trimmed = raw.trim(), line = index + 1;
    if (terminated) { if (trimmed) warn("Content appears after the Auto-Scan terminator and was not interpreted.", line); continue; }
    if (TERMINATOR.test(trimmed)) { finishController(line - 1); terminated = true; continue; }
    const address = raw.match(/^\s*Address\s+([\dA-Fa-f]{2,4}):\s*(.*)$/);
    if (address) {
      finishController(line - 1);
      if (result.controllers.length >= MAX_CONTROLLERS) throw new Error("The report exceeds the 256-controller parsing limit. No truncated report was accepted.");
      controller = { id: `controller-${line}`, address: address[1], name: address[2].split(/\s+Labels:/)[0].trim(), declaredFaultCount: null,
        faultCoverage: "unknown", faults: [], readiness: [], startLine: line, endLine: line };
      result.controllers.push(controller); continue;
    }
    if (!trimmed || /^-{3,}$/.test(trimmed)) continue;
    if (!controller) { warn("Content outside a controller section was not interpreted.", line); continue; }
    const count = trimmed.match(/^(\d+) Faults? Found:$/);
    if (count || trimmed === "No fault code found.") {
      finishFault(line - 1);
      const value = count ? Number(count[1]) : 0;
      if (!Number.isSafeInteger(value) || value > MAX_FAULTS) throw new Error("The report exceeds the 2,000-fault parsing limit. No truncated report was accepted.");
      if (controller.declaredFaultCount !== null) warn("This controller repeats its fault-count statement.", line);
      controller.declaredFaultCount = value;
      controller.faultCoverage = value === 0 ? "explicitly_absent" : "present";
      continue;
    }
    if (/^Readiness:/.test(trimmed)) { finishFault(line - 1); controller.readiness.push({ text: raw, line }); continue; }
    const faultStart = raw.match(/^(\d{1,16})\s+-\s*(.*)$/);
    if (faultStart) {
      finishFault(line - 1);
      if (++totalFaults > MAX_FAULTS) throw new Error("The report exceeds the 2,000-fault parsing limit. No truncated report was accepted.");
      fault = { id: `fault-${line}`, vendorCode: faultStart[1], genericCode: null, description: faultStart[2], details: [], freezeFrames: [], startLine: line, endLine: line };
      controller.faults.push(fault); continue;
    }
    if (fault) {
      if (trimmed === "Freeze Frame:") { frame = { id: `frame-${line}`, line, readings: [] }; fault.freezeFrames.push(frame); continue; }
      if (frame) {
        if (frame.readings.length >= MAX_FRAME_READINGS) throw new Error("A freeze frame exceeds 512 readings. No truncated report was accepted.");
        const reading = raw.trimStart(), colon = reading.indexOf(":");
        frame.readings.push({ id: `reading-${line}`, label: colon < 0 ? "" : reading.slice(0, colon), rawValue: colon < 0 ? reading : reading.slice(colon + 1).replace(/^ /, ""), line });
      } else {
        if (fault.details.length >= MAX_FAULT_DETAILS) throw new Error("A fault exceeds 256 detail lines. No truncated report was accepted.");
        fault.details.push({ text: raw, line });
        const generic = trimmed.match(/^([PBCU][\dA-F]{4})(?:\s|$)/); if (generic && fault.genericCode === null) fault.genericCode = generic[1];
      }
      continue;
    }
    // Controller/subsystem metadata stays in the immutable source, not in a made-up code catalogue.
    if (/^(?:Part No(?: SW)?|HW|Component(?: and\/or Version)?|Coding|Software Coding|Shop #|Work Shop Code|Serial number|Revision|ASAM Dataset|ROD|VCID|VINID|CVN|GVL|Subsystem \d+ - Part No(?: SW)?|Control Module Part Number):/.test(trimmed)
      || /^No ASAM data for:/.test(trimmed) || /:\s*$/.test(trimmed)) continue;
    warn("An unrecognized controller line remains in the original but was not interpreted.", line);
  }
  finishController(lines.length);
  if (!terminated) warn("The Auto-Scan end marker is missing; this file may be incomplete.");
  if (!result.controllers.length) warn("No controller sections were parsed.");
  for (const entry of result.inventory) {
    const address = entry.text.trim().split("-")[0].toUpperCase();
    if (!result.controllers.some((item) => item.address.toUpperCase() === address)) warn("An inventory entry has no corresponding parsed controller section.", entry.line);
  }
  return result;
}
