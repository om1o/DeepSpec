import { describe, expect, it } from "vitest";
import type { DiagnosticAssociation, DiagnosticBundle, DiagnosticDocument } from "../types/diagnosticReport";
import { diagnosticAssociationStatus, mergeDiagnosticBundles, normalizeDiagnosticAssociation, normalizeDiagnosticBundle, MAX_DIAGNOSTIC_ASSOCIATIONS, MAX_DIAGNOSTIC_BUNDLE_BYTES, MAX_DIAGNOSTIC_DOCUMENTS } from "./diagnosticAssociation";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const date = "2026-11-05T10:00:00.000Z";
function document(n = 1): DiagnosticDocument { return { version: 1, id: id(n), lookupId: "scan", importedAt: date, fileName: "report.txt", mime: "text/plain", byteLength: 1, sha256: "a".repeat(64), encoding: "utf-8", sourceBase64: "QQ==" }; }
function record(n = 10): DiagnosticAssociation { return { version: 1, id: id(n), lookupId: "scan", documentId: id(1), sourceSha256: "a".repeat(64), recordedAt: date, subject: "Reported sensor code and visible connector", entryIds: ["controller-2", "fault-4", "reading-9"],
  photos: [{ lookupId: "scan", photoId: "photo-1", photoLabel: "overview", photoAddedAt: date, scanSavedAt: date, sha256: "b".repeat(64), width: 40, height: 30, observedOn: null, vehicleContext: { model: "Supplied model" } }], vehicleRelationship: "unconfirmed", basis: "", notes: " No diagnosis inferred.\n" }; }
const bundle = (records: DiagnosticAssociation[] = [record()]): DiagnosticBundle => ({ documents: [document()], associations: records });

describe("immutable diagnostic association model", () => {
  it("retains exact notes, original bytes, selected entries and frozen photo evidence", () => {
    const original = bundle(); expect(normalizeDiagnosticBundle(original,"scan")).toEqual(original);
    const input = record(), normalized = normalizeDiagnosticAssociation(input)!; normalized.photos[0].vehicleContext!.model = "Changed clone";
    expect(input.photos[0].vehicleContext?.model).toBe("Supplied model");
  });
  it("requires explicit supporting basis for human vehicle claims without inferring them from VIN", () => {
    expect(normalizeDiagnosticAssociation({ ...record(), vehicleRelationship: "same_vehicle" })).toBeNull();
    expect(normalizeDiagnosticAssociation({ ...record(), vehicleRelationship: "different_vehicle", basis: "Owner supplied separate vehicle identities" })).not.toBeNull();
    expect(normalizeDiagnosticAssociation({ ...record(), photos: [{ ...record().photos[0], vehicleContext: { vin: "12345678901234567" } }] })?.vehicleRelationship).toBe("unconfirmed");
  });
  it.each([
    { version: "1" }, { id: "bad" }, { lookupId: ".." }, { documentId: "bad" }, { sourceSha256: "x".repeat(64) },
    { recordedAt: "2026-02-30T10:00:00Z" }, { subject: "  " }, { subject: "x".repeat(201) }, { notes: "x".repeat(4001) },
    { entryIds: ["controller-0"] }, { entryIds: ["controller-1","controller-1"] }, { entryIds: ["invented-1"] },
    { photos: [] }, { photos: [record().photos[0],record().photos[0]] }, { photos: [{ ...record().photos[0],lookupId: "foreign" }] },
    { supersedesId: id(10), correctionReason: "Cycle" }, { correctionReason: "No reference" }, { supersedesId: id(9), correctionReason: "" },
  ])("rejects invalid association fields without a fabricated replacement: %j", (change) => { expect(normalizeDiagnosticAssociation({ ...record(), ...change })).toBeNull(); });
  it("validates source/document and correction references but leaves exact parsed-entry verification asynchronous", () => {
    expect(normalizeDiagnosticBundle(bundle([{ ...record(), entryIds: ["fault-19999"] }]),"scan")).not.toBeNull();
    expect(normalizeDiagnosticBundle({ documents: [],associations:[record()] },"scan")).toBeNull();
    expect(normalizeDiagnosticBundle(bundle([{ ...record(),sourceSha256:"b".repeat(64) }]),"scan")).toBeNull();
    expect(normalizeDiagnosticBundle(bundle([{ ...record(),supersedesId:id(20),correctionReason:"Missing" }]),"scan")).toBeNull();
    expect(normalizeDiagnosticBundle(bundle(),"foreign")).toBeNull();
  });
  it("rejects duplicate IDs across kinds and correction cycles", () => {
    expect(normalizeDiagnosticBundle(bundle([record(),record()]),"scan")).toBeNull();
    expect(normalizeDiagnosticBundle(bundle([{ ...record(),id:id(1) }]),"scan")).toBeNull();
    expect(normalizeDiagnosticBundle(bundle([{...record(10),supersedesId:id(11),correctionReason:"A"},{...record(11),supersedesId:id(10),correctionReason:"B"}]),"scan")).toBeNull();
  });
  it("allows exact immutable retry, sorts deterministically, and refuses changed same-ID originals", () => {
    const first = bundle([record(11)]), second = bundle([record(10)]);
    expect(mergeDiagnosticBundles(first,second,"scan").associations.map((v)=>v.id)).toEqual([id(10),id(11)]);
    expect(mergeDiagnosticBundles(first,first,"scan")).toEqual(first);
    expect(() => mergeDiagnosticBundles(first,{...second,documents:[{...document(),fileName:"renamed.txt"}]},"scan")).toThrow("conflicting content");
    expect(() => mergeDiagnosticBundles(first,bundle([{...record(11),notes:"changed"}]),"scan")).toThrow("conflicting content");
  });
  it("keeps both independently imported corrections and marks their lineage conflicted", () => {
    const root = record(10), left = {...record(11),supersedesId:root.id,correctionReason:"First correction"}, right = {...record(12),supersedesId:root.id,correctionReason:"Independent correction"};
    const merged = mergeDiagnosticBundles(bundle([root,left]),bundle([root,right]),"scan");
    expect(merged.associations).toHaveLength(3);
    for (const entry of merged.associations) expect(diagnosticAssociationStatus(entry,merged.associations)).toBe("conflicting_correction");
    expect(diagnosticAssociationStatus(root,[root,left])).toBe("superseded"); expect(diagnosticAssociationStatus(left,[root,left])).toBe("current");
  });
  it("enforces exact collection caps without truncating history", () => {
    expect([MAX_DIAGNOSTIC_DOCUMENTS,MAX_DIAGNOSTIC_ASSOCIATIONS,MAX_DIAGNOSTIC_BUNDLE_BYTES]).toEqual([8,100,24*1024*1024]);
    const docs = Array.from({length:8},(_,i)=>document(i+1));
    const records = Array.from({length:100},(_,i)=>record(i+100));
    expect(normalizeDiagnosticBundle({documents:docs,associations:records},"scan")?.associations).toHaveLength(100);
    expect(normalizeDiagnosticBundle({documents:[...docs,document(9)],associations:records},"scan")).toBeNull();
    expect(() => mergeDiagnosticBundles({documents:docs,associations:records},{documents:[],associations:[record(300)]},"scan")).toThrow("limits");
    expect(normalizeDiagnosticBundle({...bundle(),unexpected:"x".repeat(MAX_DIAGNOSTIC_BUNDLE_BYTES)},"scan")).toBeNull();
  });
  it("does not leak mutable shop/customer fields through photo vehicle context", () => {
    const photo = {...record().photos[0],vehicleContext:{model:"Model",customerName:"PRIVATE",notes:"PRIVATE",jobId:"PRIVATE"}};
    const normalized = normalizeDiagnosticAssociation({...record(),photos:[photo]})!;
    expect(JSON.stringify(normalized)).not.toContain("PRIVATE"); expect(normalized.photos[0].vehicleContext?.model).toBe("Model");
  });
});
