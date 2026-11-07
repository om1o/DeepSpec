import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getAccountScope, setActiveAccount } from "../lib/accountScope";
import type { DiagnosticAssociation } from "../types/diagnosticReport";
import { correctionDiagnosticDraft, newDiagnosticDraft, parseDiagnosticDraft, readDiagnosticDraft, writeDiagnosticDraft } from "./diagnosticDraft";
const mocks=vi.hoisted(()=>({open:vi.fn()}));
vi.mock("./evidenceDb",()=>({openEvidenceDatabase:mocks.open,DIAGNOSTIC_DRAFT_STORE:"diagnostic-drafts",EVIDENCE_STORAGE_TIMEOUT_MS:15_000}));

// Guarded request/CAS fixture; no native multi-tab serialization claim.
function databaseFixture(){
  const rows=new Map<string,unknown>();let queue=Promise.resolve();
  const options={hang:false,failPut:false,beforeGet:undefined as (()=>void)|undefined};
  const database={close:vi.fn(),transaction:vi.fn(()=>{
    let aborted=false;const writes=new Map<string,unknown>(),deleted=new Set<string>();
    const tx:{oncomplete:(()=>void)|null;onerror:(()=>void)|null;onabort:(()=>void)|null;abort:()=>void;objectStore:()=>unknown}={
      oncomplete:null,onerror:null,onabort:null,abort:()=>{aborted=true;queueMicrotask(()=>tx.onabort?.());},
      objectStore:()=>({get:(key:unknown)=>{
        const request={result:undefined as unknown,onsuccess:null as (()=>void)|null};
        queue=queue.then(()=>{if(options.hang||aborted)return;options.beforeGet?.();request.result=structuredClone(rows.get(JSON.stringify(key)));request.onsuccess?.();if(aborted)return;
          deleted.forEach((id)=>rows.delete(id));writes.forEach((value,id)=>rows.set(id,value));tx.oncomplete?.();});return request;
      },put:(value:unknown,key:unknown)=>{if(options.failPut)throw new Error("Quota exceeded");writes.set(JSON.stringify(key),structuredClone(value));},delete:(key:unknown)=>deleted.add(JSON.stringify(key))}),
    };return tx;
  })};return{rows,database,options};
}
let db:ReturnType<typeof databaseFixture>;
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal("crypto",webcrypto);setActiveAccount("owner");db=databaseFixture();mocks.open.mockResolvedValue(db.database);});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

it("preserves incomplete exact entered text and stable association identity across read/reload",async()=>{
  const scope=getAccountScope(),draft=newDiagnosticDraft("scan");draft.record.subject="  Connector question  ";draft.record.notes="Line 1\r\n unfinished  ";draft.photoIds=["photo-1"];
  const saved=await writeDiagnosticDraft(scope,"scan",null,draft);expect(saved).toEqual({ok:true,raw:JSON.stringify(draft)});
  const read=await readDiagnosticDraft(scope,"scan");expect(read.draft).toEqual(draft);expect(read.raw).toBe(JSON.stringify(draft));
  expect(read.draft?.record.id).toBe(draft.record.id);expect(read.draft?.record.recordedAt).toBe(draft.record.recordedAt);
});
it("allows exactly one empty-expected writer and rejects stale edit/discard without losing the winner",async()=>{
  const scope=getAccountScope(),first=newDiagnosticDraft("scan"),second=newDiagnosticDraft("scan");
  const [left,right]=await Promise.all([writeDiagnosticDraft(scope,"scan",null,first),writeDiagnosticDraft(scope,"scan",null,second)]);
  expect(left.ok).toBe(true);expect(right.ok).toBe(false);if(!left.ok)throw new Error("Expected winner");
  const edited=structuredClone(first);edited.record.notes="New saved text";
  const [edit,discard]=await Promise.all([writeDiagnosticDraft(scope,"scan",left.raw,edited),writeDiagnosticDraft(scope,"scan",left.raw,null)]);
  expect(edit.ok).toBe(true);expect(discard).toMatchObject({ok:false,message:expect.stringContaining("Another tab")});
  expect((await readDiagnosticDraft(scope,"scan")).draft).toEqual(edited);
});
it("returns exact corrupt raw recovery and deletes only after an explicit exact discard",async()=>{
  const scope=getAccountScope(),key=JSON.stringify([scope.userId,"scan"]);db.rows.set(key,"{broken\r\n  exact");
  expect(await readDiagnosticDraft(scope,"scan")).toMatchObject({ok:true,raw:"{broken\r\n  exact",draft:null,message:expect.stringContaining("recovery")});
  expect((await writeDiagnosticDraft(scope,"scan",null,newDiagnosticDraft("scan"))).ok).toBe(false);
  expect(await writeDiagnosticDraft(scope,"scan","{broken\r\n  exact",null)).toEqual({ok:true,raw:null});
  expect((await readDiagnosticDraft(scope,"scan")).raw).toBeNull();expect(db.rows.has(key)).toBe(false);
});
it("keeps other account/scan drafts isolated and rejects stale generations during a transaction",async()=>{
  const scope=getAccountScope();await writeDiagnosticDraft(scope,"scan",null,newDiagnosticDraft("scan"));
  setActiveAccount("other");expect((await readDiagnosticDraft(getAccountScope(),"scan")).raw).toBeNull();
  expect((await readDiagnosticDraft(scope,"scan")).ok).toBe(false);setActiveAccount("owner");expect((await readDiagnosticDraft(scope,"scan")).ok).toBe(false);
  const fresh=getAccountScope();expect((await writeDiagnosticDraft(fresh,"other",null,newDiagnosticDraft("scan"))).ok).toBe(false);
  db.options.beforeGet=()=>setActiveAccount("other");expect((await writeDiagnosticDraft(fresh,"other",null,newDiagnosticDraft("other"))).ok).toBe(false);expect(db.rows.size).toBe(1);
});
it("preserves the previous raw draft after quota failure and timeout",async()=>{
  const scope=getAccountScope(),draft=newDiagnosticDraft("scan"),raw=JSON.stringify(draft);await writeDiagnosticDraft(scope,"scan",null,draft);
  db.options.failPut=true;expect((await writeDiagnosticDraft(scope,"scan",raw,{...draft,record:{...draft.record,notes:"Unsaved"}})).ok).toBe(false);
  expect((await readDiagnosticDraft(scope,"scan")).raw).toBe(raw);
  vi.useFakeTimers();db.options.hang=true;const pending=writeDiagnosticDraft(scope,"scan",raw,null);await vi.advanceTimersByTimeAsync(15_001);expect(await pending).toMatchObject({ok:false,message:expect.stringContaining("stalled")});
  expect(db.rows.get(JSON.stringify([scope.userId,"scan"]))).toBe(raw);
});
it("retains correction frozen evidence but creates a new identity and requires an eventual reason",()=>{
  const draft=newDiagnosticDraft("scan"),date="2026-11-05T10:00:00.000Z";
  const original:DiagnosticAssociation={...draft.record,documentId:"00000000-0000-4000-8000-000000000001",sourceSha256:"a".repeat(64),subject:"Connector",entryIds:["fault-4"],
    photos:[{lookupId:"scan",photoId:"photo-1",photoLabel:"close_up",photoAddedAt:date,scanSavedAt:date,sha256:"b".repeat(64),width:40,height:30,observedOn:null,vehicleContext:{model:"Original car"}}]};
  const correction=correctionDiagnosticDraft(original);expect(correction.record.id).not.toBe(original.id);expect(correction.record.supersedesId).toBe(original.id);
  expect(correction.record.photos).toEqual(original.photos);expect(correction.record.entryIds).toEqual(original.entryIds);expect(correction.record.correctionReason).toBe("");
  expect(parseDiagnosticDraft(JSON.stringify(correction))).toEqual(correction);
});
it("rejects invalid dates, foreign frozen photos, oversized raw text and mismatched document/hash fields",()=>{
  const draft=newDiagnosticDraft("scan");
  expect(parseDiagnosticDraft(JSON.stringify({...draft,updatedAt:"2026-02-30T00:00:00Z"}))).toBeNull();
  expect(parseDiagnosticDraft(JSON.stringify({...draft,record:{...draft.record,notes:"x".repeat(4001)}}))).toBeNull();
  expect(parseDiagnosticDraft(JSON.stringify({...draft,record:{...draft.record,documentId:"00000000-0000-4000-8000-000000000001"}}))).toBeNull();
  expect(parseDiagnosticDraft(" ".repeat(100001))).toBeNull();
  const photo={lookupId:"other",photoId:"photo-1",photoLabel:"overview",photoAddedAt:draft.updatedAt,scanSavedAt:draft.updatedAt,sha256:"b".repeat(64),width:1,height:1,observedOn:null,vehicleContext:null};
  expect(parseDiagnosticDraft(JSON.stringify({...draft,photoIds:["photo-1"],record:{...draft.record,photos:[photo]}}))).toBeNull();
});
it("does not overwrite a non-string corrupted store row",async()=>{
  const scope=getAccountScope(),key=JSON.stringify([scope.userId,"scan"]);db.rows.set(key,{unreadable:"preserve"});
  expect((await readDiagnosticDraft(scope,"scan")).ok).toBe(false);expect((await writeDiagnosticDraft(scope,"scan",null,null)).ok).toBe(false);expect(db.rows.get(key)).toEqual({unreadable:"preserve"});
});
