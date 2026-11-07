import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { getAccountScope, setActiveAccount } from "../lib/accountScope";
import type { DiagnosticAssociation, DiagnosticBundle, DiagnosticDocument, ParsedDiagnosticReport } from "../types/diagnosticReport";
const mocks = vi.hoisted(() => ({ open: vi.fn(), verify: vi.fn() }));
vi.mock("./evidenceDb", () => ({ openEvidenceDatabase: mocks.open, DIAGNOSTIC_REPORT_STORE: "diagnostic-reports", EVIDENCE_STORAGE_TIMEOUT_MS: 15_000 }));
vi.mock("../lib/diagnosticReport", async (original) => ({ ...await original<typeof import("../lib/diagnosticReport")>(), verifyDiagnosticDocument: mocks.verify }));
import { appendDiagnosticAssociation, appendDiagnosticDocument, importDiagnosticBundle, readDiagnosticBundle, verifyDiagnosticBundle, DIAGNOSTIC_REPORTS_CHANGED, subscribeDiagnosticReports } from "./diagnosticReportStore";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const date = "2026-11-05T10:00:00.000Z";
function document(n = 1): DiagnosticDocument { return { version: 1, id: id(n), lookupId: "scan", importedAt: date, fileName: "report.txt", mime: "text/plain", byteLength: 1, sha256: "a".repeat(64), encoding: "utf-8", sourceBase64: "QQ==" }; }
function record(n = 10): DiagnosticAssociation { return { version: 1, id: id(n), lookupId: "scan", documentId: id(1), sourceSha256: "a".repeat(64), recordedAt: date, subject: "Connector reference", entryIds: ["controller-2","fault-4","frame-5","reading-6"],
  photos: [{ lookupId: "scan", photoId: "photo-1", photoLabel: "overview", photoAddedAt: date, scanSavedAt: date, sha256: "b".repeat(64), width: 40, height: 30, observedOn: null, vehicleContext: null }],vehicleRelationship:"unconfirmed",basis:"",notes:"" }; }
function parsed(): ParsedDiagnosticReport { return { parser:"vcds-autoscan-text-v1",format:"vcds_autoscan",coverage:"incomplete",sourceVersion:null,exampleVersionMatched:false,reportedTime:null,reportedVin:null,reportedMileage:null,inventory:[],warnings:[{message:"Fixture incomplete"}],lineCount:6,
  controllers:[{id:"controller-2",address:"01",name:"Engine",declaredFaultCount:null,faultCoverage:"present",readiness:[],startLine:2,endLine:6,faults:[{id:"fault-4",vendorCode:"12345",genericCode:null,description:"Reported fault",details:[],startLine:4,endLine:6,freezeFrames:[{id:"frame-5",line:5,readings:[{id:"reading-6",label:"RPM",rawValue:"0 /min",line:6}]}]}]}] }; }
const key = JSON.stringify(["owner","scan"]);

// Request sequencing fixture validates app CAS guards. Real native IDB cross-tab
// serialization is a separate browser acceptance check, not claimed here.
function databaseFixture() {
  const rows = new Map<string,unknown>(); let queue = Promise.resolve();
  const options = { failPut:false,hang:false,beforeGet:undefined as (()=>void)|undefined };
  const database = { close:vi.fn(),transaction:vi.fn((_name:string,mode:string)=> {
    let aborted=false; const writes=new Map<string,unknown>();
    const tx:{oncomplete:(()=>void)|null;onerror:(()=>void)|null;onabort:(()=>void)|null;abort:()=>void;objectStore:()=>unknown} = {
      oncomplete:null,onerror:null,onabort:null,abort:()=>{aborted=true;queueMicrotask(()=>tx.onabort?.());},
      objectStore:()=>({get:(storedKey:unknown)=> {
        const request={result:undefined as unknown,onsuccess:null as (()=>void)|null};
        queue=queue.then(()=>{if(options.hang||aborted)return; options.beforeGet?.(); request.result=structuredClone(rows.get(JSON.stringify(storedKey)));request.onsuccess?.();if(aborted)return;
          if(mode==="readwrite")writes.forEach((value,id)=>rows.set(id,value));tx.oncomplete?.();});return request;
      },put:(value:unknown,storedKey:unknown)=>{if(options.failPut)throw new Error("Quota exceeded");writes.set(JSON.stringify(storedKey),structuredClone(value));}}),
    };return tx;
  })};return {rows,database,options};
}

describe("verified immutable diagnostic storage",()=>{
  let db:ReturnType<typeof databaseFixture>;
  beforeEach(()=>{vi.resetAllMocks();setActiveAccount("owner");db=databaseFixture();mocks.open.mockResolvedValue(db.database);mocks.verify.mockResolvedValue(parsed());vi.stubGlobal("BroadcastChannel",undefined);});
  afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
  it("reads absent evidence without creating a bucket and isolates account keys",async()=>{
    expect(await readDiagnosticBundle("scan")).toEqual({documents:[],associations:[]});expect(db.rows.size).toBe(0);
    await appendDiagnosticDocument(document());setActiveAccount("other");expect((await readDiagnosticBundle("scan")).documents).toHaveLength(0);expect(db.rows.has(key)).toBe(true);
  });
  it("verifies exact originals on ingress and every read, including unrecognized/incomplete reports",async()=>{
    await appendDiagnosticDocument(document());expect(mocks.verify).toHaveBeenCalledWith(document());mocks.verify.mockClear();
    expect((await readDiagnosticBundle("scan")).documents[0].sourceBase64).toBe("QQ==");expect(mocks.verify).toHaveBeenCalledTimes(1);
    mocks.verify.mockResolvedValue({...parsed(),format:"unrecognized",coverage:"unrecognized",controllers:[]});
    expect((await appendDiagnosticDocument(document(2))).documents).toHaveLength(2);
    expect((await appendDiagnosticAssociation({...record(),entryIds:[]})).associations).toHaveLength(1);
  });
  it("checks actual parsed entry membership, not just well-formed IDs",async()=>{
    await appendDiagnosticDocument(document());await appendDiagnosticAssociation(record());
    await expect(appendDiagnosticAssociation({...record(11),entryIds:["fault-19999"]})).rejects.toThrow("absent from its exact original");
    expect((await readDiagnosticBundle("scan")).associations).toHaveLength(1);
    expect((await verifyDiagnosticBundle({documents:[document()],associations:[record()]},"scan")).associations[0].entryIds).toEqual(record().entryIds);
  });
  it("unions simultaneous appends after verification rather than overwriting a newer bucket",async()=>{
    await Promise.all([appendDiagnosticDocument(document(1)),appendDiagnosticDocument(document(2))]);
    expect((await readDiagnosticBundle("scan")).documents.map((v)=>v.id)).toEqual([id(1),id(2)]);
    await Promise.all([appendDiagnosticAssociation(record(10)),appendDiagnosticAssociation(record(11))]);
    expect((await readDiagnosticBundle("scan")).associations.map((v)=>v.id)).toEqual([id(10),id(11)]);
  });
  it("rechecks a changed raw bucket after async verification and preserves its independent record",async()=>{
    await appendDiagnosticDocument(document());let release:((value:ParsedDiagnosticReport)=>void)|undefined;
    mocks.verify.mockImplementationOnce(()=>new Promise<ParsedDiagnosticReport>((resolve)=>{release=resolve;}));
    const pending=appendDiagnosticAssociation(record());
    for(let i=0;i<20&&!release;i++)await Promise.resolve();
    expect(release).toBeDefined();db.rows.set(key,{documents:[document(),document(2)],associations:[]});release!(parsed());
    const result=await pending;expect(result.documents).toHaveLength(2);expect(result.associations).toHaveLength(1);
  });
  it("rejects changed source hash or malformed parser input and preserves all exact stored bytes",async()=>{
    await appendDiagnosticDocument(document());const raw=structuredClone(db.rows.get(key));
    mocks.verify.mockRejectedValue(new Error("Source fingerprint mismatch"));
    await expect(readDiagnosticBundle("scan")).rejects.toThrow("fingerprint");
    await expect(appendDiagnosticDocument(document(2))).rejects.toThrow("fingerprint");expect(db.rows.get(key)).toEqual(raw);
    mocks.verify.mockRejectedValue(new Error("Report line exceeds limit"));await expect(readDiagnosticBundle("scan")).rejects.toThrow("line exceeds");expect(db.rows.get(key)).toEqual(raw);
  });
  it("uses actual SHA verification to reject a same-length byte mutation while preserving the corrupted original for recovery",async()=>{
    vi.stubGlobal("crypto",webcrypto);
    const actual=await vi.importActual<typeof import("../lib/diagnosticReport")>("../lib/diagnosticReport");mocks.verify.mockImplementation(actual.verifyDiagnosticDocument);
    const original={...document(),sha256:"559aead08264d5795d3909718cdd05abd49572e84fe55590eef31a88a08fdffd"};
    await appendDiagnosticDocument(original);
    expect((await readDiagnosticBundle("scan")).documents[0]).toEqual(original);
    const corrupt={documents:[{...original,sourceBase64:"Qg=="}],associations:[]};db.rows.set(key,corrupt);
    await expect(readDiagnosticBundle("scan")).rejects.toThrow("fingerprint");expect(db.rows.get(key)).toEqual(corrupt);
    await expect(appendDiagnosticDocument({...original,id:id(2)})).rejects.toThrow("fingerprint");expect(db.rows.get(key)).toEqual(corrupt);
  });
  it("never erases malformed storage to make room for a new original",async()=>{
    db.rows.set(key,{documents:[{...document(),sourceBase64:"corrupt"}],associations:[]});const raw=structuredClone(db.rows.get(key));
    await expect(appendDiagnosticDocument(document(2))).rejects.toThrow("preserved");expect(db.rows.get(key)).toEqual(raw);
  });
  it("allows exact retries but refuses same-ID mutation, missing references and cross-kind collisions",async()=>{
    await appendDiagnosticDocument(document());expect((await appendDiagnosticDocument(document())).documents).toHaveLength(1);
    await expect(appendDiagnosticDocument({...document(),fileName:"renamed.txt"})).rejects.toThrow("conflicting content");
    await expect(appendDiagnosticAssociation({...record(),documentId:id(2)})).rejects.toThrow("references");
    await expect(appendDiagnosticAssociation({...record(),id:id(1)})).rejects.toThrow("conflicting content");
    await expect(importDiagnosticBundle("other",{documents:[document()],associations:[]})).rejects.toThrow("different scan");
  });
  it("rejects stale local corrections but preserves verified correction forks imported from another device",async()=>{
    await appendDiagnosticDocument(document());await appendDiagnosticAssociation(record());
    const correction={...record(11),supersedesId:id(10),correctionReason:"Corrected note"},fork={...record(12),supersedesId:id(10),correctionReason:"Other device"};
    await appendDiagnosticAssociation(correction);await expect(appendDiagnosticAssociation(fork)).rejects.toThrow("already corrected");
    expect((await appendDiagnosticAssociation(correction)).associations).toHaveLength(2);
    expect((await importDiagnosticBundle("scan",{documents:[document()],associations:[record(),fork]})).associations).toHaveLength(3);
  });
  it("blocks stale account scopes before opening, after hashing, and inside transactions",async()=>{
    const scope=getAccountScope();setActiveAccount("other");await expect(appendDiagnosticDocument(document(),scope)).rejects.toThrow("Account changed");expect(mocks.open).not.toHaveBeenCalled();
    setActiveAccount("owner");mocks.verify.mockImplementationOnce(async()=>{setActiveAccount("other");return parsed();});
    await expect(appendDiagnosticDocument(document())).rejects.toThrow("Account changed");expect(db.rows.size).toBe(0);
    setActiveAccount("owner");db.options.beforeGet=()=>setActiveAccount("other");await expect(readDiagnosticBundle("scan")).rejects.toThrow("Account changed");
  });
  it("leaves prior originals intact after quota failure or transaction timeout",async()=>{
    await appendDiagnosticDocument(document());db.options.failPut=true;await expect(appendDiagnosticDocument(document(2))).rejects.toThrow("Quota");
    expect((db.rows.get(key) as DiagnosticBundle).documents).toHaveLength(1);
    vi.useFakeTimers();db.options.hang=true;const pending=expect(readDiagnosticBundle("scan")).rejects.toThrow("stalled");await vi.advanceTimersByTimeAsync(15_001);await pending;
  });
  it("notifies only committed changes for the captured owner and stops after unsubscribe",async()=>{
    const listener=vi.fn(),stop=subscribeDiagnosticReports(listener);await appendDiagnosticDocument(document());expect(listener).toHaveBeenCalledWith("scan");listener.mockClear();
    await appendDiagnosticDocument(document());expect(listener).not.toHaveBeenCalled();
    window.dispatchEvent(new CustomEvent(DIAGNOSTIC_REPORTS_CHANGED,{detail:{owner:"other",lookupId:"scan"}}));expect(listener).not.toHaveBeenCalled();
    stop();await appendDiagnosticDocument(document(2));expect(listener).not.toHaveBeenCalled();
  });
});
