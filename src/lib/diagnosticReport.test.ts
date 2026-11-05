import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiagnosticDocument } from "../types/diagnosticReport";
import { MAX_DIAGNOSTIC_SOURCE_BYTES, createDiagnosticDocument, diagnosticEntryIds, diagnosticSourceBytes, diagnosticSourceText, normalizeDiagnosticDocument, parseDiagnosticText, verifyDiagnosticDocument } from "./diagnosticReport";

// Entirely synthetic reports. No vendor report or proprietary description is bundled.
const HEADER = ["Thursday,05,November,2026,09:30:00:00001", "VCDS -- Synthetic test export", "VCDS Version: 22.4.0.1 (x64)", "Data version: synthetic", "Chassis Type: TEST", "Scan: 01 811E", "VIN: SYNTHETICVIN000001   License Plate: PRIVATE_PLATE", "Mileage: 123 km   Repair Order: PRIVATE_ORDER"];
const FAULT = ["00123456 - Synthetic fault description", "          U1234 00 [032] - Synthetic elaboration", "          Intermittent - Not Confirmed - Tested Since Memory Clear", "             Freeze Frame:", "                    Temperature: -6.30 °C", "                    Temperature: 12.00 °C", "                    State: OFF", "                    Binary:  0 00  0", "                    No units: 0.0", "                    126"];
const report = (middle = FAULT) => [...HEADER, "01-Engine -- Status: Malfunction 0010", "811E-Synthetic Module -- Status: OK 0000", "-----", "Address 01: Engine (TEST)       Labels: None", "   Component: Synthetic component", "1 Fault Found:", ...middle, "Readiness: 0000 0000", "-----", "Address 811E: Synthetic Module       Labels: None", "No fault code found.", "End----------------", ""].join("\n");
const file = (text: string, name = "synthetic.txt", type = "text/plain") => new File([text], name, { type });
const DOC_ID = "12345678-1234-4234-8234-123456789abc";
beforeEach(() => { vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("narrow synthetic VCDS Auto-Scan parsing", () => {
  it("preserves opaque IDs, unconfirmed status, repeated labels, values and 4-character addresses", () => {
    const parsed = parseDiagnosticText(report());
    expect(parsed).toMatchObject({ format: "vcds_autoscan", coverage: "complete", sourceVersion: "22.4.0.1", exampleVersionMatched: true, reportedTime: HEADER[0], reportedVin: "SYNTHETICVIN000001", reportedMileage: "123 km", warnings: [] });
    expect(parsed.controllers).toHaveLength(2);
    const [engine, other] = parsed.controllers;
    expect(engine).toMatchObject({ address: "01", name: "Engine (TEST)", declaredFaultCount: 1, faultCoverage: "present" });
    expect(other).toMatchObject({ address: "811E", declaredFaultCount: 0, faultCoverage: "explicitly_absent" });
    expect(engine.faults[0]).toMatchObject({ vendorCode: "00123456", genericCode: "U1234", description: "Synthetic fault description" });
    expect(engine.faults[0].details.map((detail) => detail.text)).toEqual(FAULT.slice(1, 3));
    expect(engine.faults[0].freezeFrames[0].readings.map(({ label, rawValue }) => [label, rawValue])).toEqual([
      ["Temperature", "-6.30 °C"], ["Temperature", "12.00 °C"], ["State", "OFF"], ["Binary", " 0 00  0"], ["No units", "0.0"], ["", "126"],
    ]);
    expect(JSON.stringify(parsed)).not.toContain("PRIVATE_PLATE"); expect(JSON.stringify(parsed)).not.toContain("PRIVATE_ORDER");
  });
  it("keeps distinct faults with the same generic code and stable source-line associations", () => {
    const text = report([...FAULT, ...FAULT.map((line) => line.replace("00123456 -", "00987654 -"))]).replace("1 Fault Found:", "2 Faults Found:");
    const parsed = parseDiagnosticText(text), faultEntries = parsed.controllers[0].faults;
    expect(parsed.coverage).toBe("complete"); expect(faultEntries).toHaveLength(2);
    expect(faultEntries.map((entry) => entry.genericCode)).toEqual(["U1234", "U1234"]);
    const ids = diagnosticEntryIds(parsed); expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(faultEntries[0].freezeFrames[0].id); expect(ids).toContain(faultEntries[1].freezeFrames[0].readings[0].id);
    expect(diagnosticEntryIds(parseDiagnosticText(text.replace(/\n/g, "\r\n")))).toEqual(ids);
    for (const entry of faultEntries) {
      expect(text.split("\n")[entry.startLine - 1]).toContain(entry.vendorCode);
      expect(entry.endLine).toBeGreaterThan(entry.startLine);
    }
  });
  it("does not infer no-fault coverage when the statement/count is absent", () => {
    const parsed = parseDiagnosticText(report().replace("No fault code found.", ""));
    expect(parsed.coverage).toBe("incomplete"); expect(parsed.controllers[1].faultCoverage).toBe("unknown");
    expect(parsed.warnings.some((entry) => entry.message.includes("no recognized fault count"))).toBe(true);
  });
  it.each([
    ["missing terminator", (value: string) => value.replace("End----------------", "")],
    ["malformed terminator", (value: string) => value.replace("End----------------", "End----unexpected suffix")],
    ["count mismatch", (value: string) => value.replace("1 Fault Found:", "2 Faults Found:")],
    ["contradiction", (value: string) => value.replace("1 Fault Found:", "No fault code found.")],
    ["unrecognized controller content", (value: string) => value.replace("No fault code found.", "No fault code found.\nUnrecognized result text")],
    ["post-terminator content", (value: string) => `${value}Ignored content`],
    ["missing controller", (value: string) => value.replace(/Address 811E:[\s\S]*?No fault code found\./, "")],
  ])("marks %s incomplete without dropping the original parsed fault", (_label, alter) => {
    const parsed = parseDiagnosticText(alter(report())); expect(parsed.coverage).toBe("incomplete");
    expect(parsed.controllers[0].faults[0].vendorCode).toBe("00123456"); expect(parsed.warnings.length).toBeGreaterThan(0);
  });
  it("does not claim current-version compatibility or supply a missing timezone", () => {
    const parsed = parseDiagnosticText(report().replace("22.4.0.1", "26.9.0"));
    expect(parsed).toMatchObject({ sourceVersion: "26.9.0", exampleVersionMatched: false, coverage: "incomplete", reportedTime: HEADER[0] });
    expect(parsed.warnings.some((warning) => warning.message.includes("compatibility is unverified"))).toBe(true);
  });
  it("recognizes missing headers/controllers without claiming a complete scan", () => {
    expect(parseDiagnosticText(report().replace("Chassis Type: TEST", "")).coverage).toBe("incomplete");
    expect(parseDiagnosticText([...HEADER, "End-------------"].join("\n"))).toMatchObject({ coverage: "incomplete", controllers: [] });
  });
  it.each(["<html><body>Report</body></html>", "%PDF-1.7", "A generic scanner report", "VCDS -- Synthetic test\nVCDS Version: 17.8.0.1\nAddress 01: Engine\n1 Fault Found:\n12345 - Synthetic fault"])("keeps unsupported text unrecognized", (text) => {
    expect(parseDiagnosticText(text)).toMatchObject({ coverage: "unrecognized", format: "unrecognized", controllers: [] });
  });
  it("enforces hard limits rather than returning partial successful data", () => {
    expect(() => parseDiagnosticText("x".repeat(MAX_DIAGNOSTIC_SOURCE_BYTES + 1))).toThrow("2 MiB");
    expect(() => parseDiagnosticText("x\n".repeat(20_001))).toThrow("20,000-line");
    expect(() => parseDiagnosticText("x".repeat(4097))).toThrow("4,096");
    expect(() => parseDiagnosticText([...HEADER, ...Array.from({ length: 257 }, (_, index) => `Address ${index.toString(16).padStart(2, "0")}: Test\nNo fault code found.`), "End----------"].join("\n"))).toThrow("256-controller");
    expect(() => parseDiagnosticText(report().replace("1 Fault Found:", "2001 Faults Found:"))).toThrow("2,000-fault");
    expect(() => parseDiagnosticText(report([...FAULT.slice(0, 4), ...Array.from({ length: 513 }, () => "                    Value: 1")]))).toThrow("512 readings");
    expect(() => parseDiagnosticText(report([FAULT[0], ...Array.from({ length: 257 }, () => "          Detail")]))).toThrow("256 detail lines");
  });
});

describe("immutable diagnostic source documents", () => {
  it("round-trips exact UTF-8 bytes, including CRLF/BOM, and independently verifies source hash", async () => {
    const source = `\uFEFF${report().replace(/\n/g, "\r\n")}`;
    const document = await createDiagnosticDocument(file(source), "scan-1", "utf-8", DOC_ID);
    expect(document).toMatchObject({ id: DOC_ID, lookupId: "scan-1", encoding: "utf-8", fileName: "synthetic.txt", mime: "text/plain" });
    // jsdom Uint8Array and Node's TextEncoder output can have different realms.
    // Compare every byte, including the BOM and CRLF, without comparing prototypes.
    expect(Array.from(diagnosticSourceBytes(document))).toEqual(Array.from(new TextEncoder().encode(source)));
    expect(diagnosticSourceText(document)).toBe(source.slice(1));
    expect(await verifyDiagnosticDocument(document)).toMatchObject({ format: "vcds_autoscan", coverage: "complete" });
    await expect(verifyDiagnosticDocument({ ...document, sha256: "a".repeat(64) })).rejects.toThrow("fingerprint");
    const changed = { ...document, sourceBase64: btoa(atob(document.sourceBase64).replace("TEST", "TAST")) };
    await expect(verifyDiagnosticDocument(changed)).rejects.toThrow("fingerprint");
  });
  it("requires explicit Windows-1252 and retains original degree and euro bytes", async () => {
    const ascii = report().replaceAll("°", "~");
    const bytes = Uint8Array.from(ascii, (character) => character === "~" ? 0xb0 : character.charCodeAt(0));
    const sourceFile = new File([bytes.buffer], "synthetic.TXT", { type: "text/plain" });
    await expect(createDiagnosticDocument(sourceFile, "scan-1")).rejects.toThrow("Choose Windows-1252");
    const document = await createDiagnosticDocument(sourceFile, "scan-1", "windows-1252", DOC_ID);
    expect(diagnosticSourceBytes(document)).toEqual(bytes); expect(diagnosticSourceText(document)).toContain("-6.30 °C");
    expect(await verifyDiagnosticDocument(document)).toMatchObject({ coverage: "complete" });
    expect(normalizeDiagnosticDocument({ ...document, encoding: "utf-8" })).toBeNull();
    const euro = await createDiagnosticDocument(new File([new Uint8Array([0x80]).buffer], "synthetic.txt"), "scan-1", "windows-1252");
    expect(diagnosticSourceText(euro)).toBe("€"); expect(diagnosticSourceBytes(euro)[0]).toBe(0x80);
  });
  it("retains unsupported and incomplete text for download without inventing parsed evidence", async () => {
    const unknown = await createDiagnosticDocument(file("Unrecognized synthetic source"), "scan-1");
    expect(diagnosticSourceText(unknown)).toBe("Unrecognized synthetic source"); expect((await verifyDiagnosticDocument(unknown)).coverage).toBe("unrecognized");
    const truncated = await createDiagnosticDocument(file(report().replace("End----------------", "")), "scan-1");
    expect((await verifyDiagnosticDocument(truncated)).coverage).toBe("incomplete");
  });
  it("validates owner-scan binding, immutable metadata, dates and canonical base64", async () => {
    const document = await createDiagnosticDocument(file("Synthetic"), "scan-1", "utf-8", DOC_ID);
    expect(normalizeDiagnosticDocument(document, "scan-1")).toEqual(document);
    expect(normalizeDiagnosticDocument(document, "scan-2")).toBeNull();
    const bad: Partial<DiagnosticDocument>[] = [{ id: "../id" }, { lookupId: ".." }, { importedAt: "2026-02-30T00:00:00Z" }, { importedAt: "0000-01-01T00:00:00Z" }, { importedAt: "2026-11-05" }, { byteLength: 1 }, { byteLength: MAX_DIAGNOSTIC_SOURCE_BYTES + 1 }, { sourceBase64: `${document.sourceBase64}\n` }, { sha256: "x".repeat(64) }, { fileName: "../file.txt" }, { fileName: "" }, { mime: "text/html" }];
    for (const change of bad) expect(normalizeDiagnosticDocument({ ...document, ...change })).toBeNull();
    expect(normalizeDiagnosticDocument({ ...document, encoding: "latin1" })).toBeNull();
    expect(normalizeDiagnosticDocument({ ...document, derived: "must not be trusted" })).toBeNull();
    expect(normalizeDiagnosticDocument({ ...document, byteLength: 1, sourceBase64: "Zh==" })).toBeNull(); // Nonzero unused padding bits.
  });
  it("rejects binary and wrong MIME inputs without running or fetching content", async () => {
    const network = vi.fn(); vi.stubGlobal("fetch", network);
    await expect(createDiagnosticDocument(file("x\u0000y"), "scan-1")).rejects.toThrow("Binary data");
    await expect(createDiagnosticDocument(file("<html>report</html>", "report.html", "text/html"), "scan-1")).rejects.toThrow("plain-text");
    await expect(createDiagnosticDocument(file("Synthetic", "report.html", "text/plain"), "scan-1")).rejects.toThrow(".txt");
    const original = await createDiagnosticDocument(file("<script>fetch('https://invalid.example')</script>"), "scan-1");
    expect((await verifyDiagnosticDocument(original)).coverage).toBe("unrecognized"); expect(network).not.toHaveBeenCalled();
  });
  it("rejects oversized/empty sources before reading and preserves large valid base64 without regex overflow", async () => {
    await expect(createDiagnosticDocument(file(""), "scan-1")).rejects.toThrow("nonempty");
    await expect(createDiagnosticDocument(file("x".repeat(MAX_DIAGNOSTIC_SOURCE_BYTES + 1)), "scan-1")).rejects.toThrow("2 MiB");
    const source = `${"x".repeat(2047)}\n`.repeat(1024);
    const document = await createDiagnosticDocument(file(source), "scan-1");
    expect(document.byteLength).toBe(MAX_DIAGNOSTIC_SOURCE_BYTES); expect(normalizeDiagnosticDocument(document)?.sourceBase64).toBe(document.sourceBase64);
  });
  it("rechecks parsed limits on verification of imported metadata", async () => {
    const bytes = new TextEncoder().encode("x\n".repeat(20_001));
    const digest = await webcrypto.subtle.digest("SHA-256", bytes);
    const document: DiagnosticDocument = { version: 1, id: DOC_ID, lookupId: "scan-1", importedAt: "2026-11-05T00:00:00Z", fileName: "synthetic.txt", mime: "text/plain", byteLength: bytes.length,
      sha256: Buffer.from(digest).toString("hex"), encoding: "utf-8", sourceBase64: Buffer.from(bytes).toString("base64") };
    expect(normalizeDiagnosticDocument(document)).not.toBeNull(); await expect(verifyDiagnosticDocument(document)).rejects.toThrow("20,000-line");
  });
});
