import { describe, expect, it } from "vitest";
import type { ObservationAreaBinding, ObservationAreaDraft, ObservationAreaRecord } from "../types/observationArea";
import { normalizeObservationAreaBinding, normalizeObservationAreaDraft, normalizeObservationAreaRecord, normalizeObservationAreaRecords, normalizeObservationAreaRectangle, observationAreaBindingKey, observationAreaGroups, observationAreaRecordFromDraft, observationAreaRecordStatus } from "./observationArea";

const when = "2026-11-06T00:00:00.000Z";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rectangle = { x: .1, y: .2, width: .3, height: .4 };
function binding(): ObservationAreaBinding {
  return { version: 1, observation: { id: "claim-a", text: "Brown material is visible", photoIds: ["photo-2"], regionLabel: "Lower edge" },
    analysisSha256: "a".repeat(64), analysisAttemptId: "attempt-1", reference: { lookupId: "scan", photoId: "photo-2", photoLabel: "close_up", photoAddedAt: when, scanSavedAt: when,
      sha256: "b".repeat(64), width: 640, height: 480, observedOn: null, vehicleContext: null, analysisAttemptId: "attempt-1" } };
}
function mark(n = 1): ObservationAreaRecord {
  return { version: 1, id: id(n), lookupId: "scan", recordedAt: when, binding: binding(), notes: "Human review area only", kind: "mark", rectangle: { ...rectangle } };
}
function draft(): ObservationAreaDraft {
  return { version: 1, id: id(1), lookupId: "scan", recordedAt: when, updatedAt: when, binding: binding(), expectedHeadId: null, kind: "mark", rectangle: null, notes: "", correctionReason: "" };
}
describe("observation area geometry and binding", () => {
  it("preserves exact photo/claim/source metadata defensively, never the first photo by default", () => {
    const raw = binding(), checked = normalizeObservationAreaBinding(raw, "scan")!;
    expect(checked).toEqual(raw); expect(checked.reference.photoId).toBe("photo-2");
    raw.observation.text = "Changed"; raw.reference.sha256 = "c".repeat(64);
    expect(checked.observation.text).toBe("Brown material is visible"); expect(checked.reference.sha256).toBe("b".repeat(64));
  });
  it.each([{x:-.1},{width:0},{height:-1},{x:.9,width:.2},{y:.9,height:.2},{width:NaN},{height:Infinity},{confidence:0},{x:"0.1"}])("rejects invalid human geometry without clipping or adding confidence: %j", (patch) => {
    expect(normalizeObservationAreaRectangle({...rectangle,...patch})).toBeUndefined();
  });
  it("accepts the full original boundary and rejects zero-size/sparse geometry", () => {
    expect(normalizeObservationAreaRectangle({x:0,y:0,width:1,height:1})).toEqual({x:0,y:0,width:1,height:1});
    expect(normalizeObservationAreaRectangle({x:0,y:0,width:1})).toBeUndefined();
  });
  it("retains optional per-photo AI areas separately without turning them into human rectangles", () => {
    const raw = { ...binding(), observation: { ...binding().observation, areas: [{photoId:"photo-2",rectangle}] } };
    const checked = normalizeObservationAreaBinding(raw)!;
    expect(checked).toEqual(raw); expect(observationAreaRecordFromDraft({ ...draft(), binding: checked })).toBeUndefined();
    expect(normalizeObservationAreaBinding({...raw,observation:{...raw.observation,areas:[...raw.observation.areas,...raw.observation.areas]}})).toBeUndefined();
    expect(normalizeObservationAreaBinding({...raw,observation:{...raw.observation,areas:[{photoId:"photo-1",rectangle}]}})).toBeUndefined();
    const unlocated = { ...binding(), observation: { ...binding().observation, areas: [] } };
    expect(normalizeObservationAreaBinding(unlocated)).toEqual(unlocated);
    expect(observationAreaRecordFromDraft({ ...draft(), binding: unlocated, rectangle })).toMatchObject({ kind: "mark", rectangle, binding: unlocated });
  });
  it("rejects foreign/missing citations, attempts, malformed source and unknown metadata", () => {
    for (const patch of [{analysisSha256:"bad"},{analysisSha256:"A".repeat(64)},{analysisAttemptId:"different"},{extra:"unrecognized"},{version:2}]) expect(normalizeObservationAreaBinding({...binding(),...patch})).toBeUndefined();
    for (const patch of [{photoId:"photo-1"},{width:0},{width:32768,height:32768},{photoAddedAt:"2026-02-30T00:00:00Z"},{extra:"unrecognized"}]) expect(normalizeObservationAreaBinding({...binding(),reference:{...binding().reference,...patch}})).toBeUndefined();
    expect(normalizeObservationAreaBinding(binding(),"other")).toBeUndefined();
    for (const photoIds of [[],["photo-2","photo-2"],["../photo"],Object.assign(new Array(2),{0:"photo-2"})]) expect(normalizeObservationAreaBinding({...binding(),observation:{...binding().observation,photoIds}})).toBeUndefined();
  });
  it("does not use observation ID alone as a binding key", () => {
    const original = binding();
    expect(observationAreaBindingKey(original)).not.toBe(observationAreaBindingKey({...original,observation:{...original.observation,text:"Another observation"}}));
    expect(observationAreaBindingKey(original)).not.toBe(observationAreaBindingKey({...original,analysisSha256:"c".repeat(64)}));
    expect(observationAreaBindingKey(original)).not.toBe(observationAreaBindingKey({...original,reference:{...original.reference,sha256:"c".repeat(64)}}));
  });
});
describe("immutable area history and partial drafts", () => {
  it("retains correction/retraction history and supports explicit new marks after retraction", () => {
    const first=mark(), corrected={...mark(2),supersedesId:first.id,correctionReason:"Adjusted area",rectangle:{...rectangle,x:.2}};
    const retracted:ObservationAreaRecord={version:1,id:id(3),lookupId:"scan",recordedAt:when,binding:binding(),notes:"",kind:"retraction",supersedesId:corrected.id,correctionReason:"Wrong area"};
    const revived={...mark(4),supersedesId:retracted.id,correctionReason:"New explicit review"};
    const records=normalizeObservationAreaRecords([revived,corrected,first,retracted],"scan")!;
    expect(records).toHaveLength(4); expect(observationAreaGroups(records)[0].head?.id).toBe(revived.id);
    expect(observationAreaRecordStatus(first,records)).toBe("superseded");
    expect(observationAreaRecordStatus(corrected,records)).toBe("retracted");
    expect(observationAreaRecordStatus(revived,records)).toBe("current");
    expect(observationAreaGroups([first,corrected,retracted])[0].status).toBe("retracted");
  });
  it("preserves competing branches without selecting a timestamp winner", () => {
    const first=mark(), left={...mark(2),supersedesId:first.id,correctionReason:"Left"},right={...mark(3),recordedAt:"2026-11-07T00:00:00Z",supersedesId:first.id,correctionReason:"Right"};
    const records=normalizeObservationAreaRecords([first,left,right],"scan")!;
    expect(observationAreaGroups(records)[0]).toMatchObject({head:null,status:"conflicting"});
    expect(observationAreaGroups(records)[0].heads.map((r)=>r.id)).toEqual([left.id,right.id]);
    expect(observationAreaRecordStatus(first,records)).toBe("conflicting");
    expect(observationAreaGroups([first,mark(4)])[0].head).toBeNull();
  });
  it("rejects missing/cyclic/retargeted corrections and duplicate immutable IDs", () => {
    const first=mark();
    const correction={...mark(2),supersedesId:first.id,correctionReason:"Changed"};
    expect(normalizeObservationAreaRecords([correction],"scan")).toBeUndefined();
    expect(normalizeObservationAreaRecords([first,first],"scan")).toBeUndefined();
    expect(normalizeObservationAreaRecords([{...first,supersedesId:correction.id,correctionReason:"Cycle"},correction],"scan")).toBeUndefined();
    expect(normalizeObservationAreaRecords([first,{...correction,binding:{...binding(),analysisSha256:"c".repeat(64)}}],"scan")).toBeUndefined();
    expect(normalizeObservationAreaRecord({...first,lookupId:"other"})).toBeUndefined();
    expect(normalizeObservationAreaRecord({...first,supersedesId:first.id,correctionReason:"Self"})).toBeUndefined();
  });
  it("enforces bounded complete history without dropping records", () => {
    expect(normalizeObservationAreaRecords(Array.from({length:101},(_,i)=>mark(i+1)),"scan")).toBeUndefined();
    expect(normalizeObservationAreaRecords(Array.from({length:80},(_,i)=>({...mark(i+1),notes:"界".repeat(1000)})),"scan")).toBeUndefined();
    expect(normalizeObservationAreaRecord({...mark(),notes:"x".repeat(1001)})).toBeUndefined();
  });
  it("keeps incomplete recovery drafts but requires explicit geometry/reason before commit", () => {
    expect(normalizeObservationAreaDraft(draft())).toEqual(draft());
    expect(observationAreaRecordFromDraft(draft())).toBeUndefined();
    expect(observationAreaRecordFromDraft({...draft(),rectangle})).toEqual({...mark(),notes:""});
    expect(observationAreaRecordFromDraft({...draft(),id:id(2),expectedHeadId:id(1),rectangle})).toBeUndefined();
    expect(observationAreaRecordFromDraft({...draft(),id:id(2),expectedHeadId:id(1),kind:"retraction",correctionReason:"Withdraw"})).toMatchObject({kind:"retraction",supersedesId:id(1)});
    expect(normalizeObservationAreaDraft({...draft(),kind:"retraction"})).toBeUndefined();
    expect(normalizeObservationAreaDraft({...draft(),extra:"unrecognized"})).toBeUndefined();
  });
});
