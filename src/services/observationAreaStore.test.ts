import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountScope, setActiveAccount } from "../lib/accountScope";
import { observationAreaRecordFromDraft } from "../lib/observationArea";
import type { ObservationAreaDraft, ObservationAreaRecord } from "../types/observationArea";
const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("./evidenceDb", () => ({ openEvidenceDatabase: mocks.open, OBSERVATION_AREA_STORE: "observation-areas", OBSERVATION_AREA_DRAFT_STORE: "observation-area-drafts", EVIDENCE_STORAGE_TIMEOUT_MS: 15_000 }));
import { commitObservationAreaDraft, OBSERVATION_AREAS_CHANGED, readObservationAreaDraft, readObservationAreas, subscribeObservationAreas, writeObservationAreaDraft } from "./observationAreaStore";

const when = "2026-11-06T00:00:00.000Z", RECT = { x: .1, y: .2, width: .3, height: .4 };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function draft(n = 1): ObservationAreaDraft {
  return { version:1,id:id(n),lookupId:"scan",recordedAt:when,updatedAt:when,kind:"mark",expectedHeadId:null,rectangle:{...RECT},notes:"Human note",correctionReason:"",
    binding:{version:1,observation:{id:"claim",text:"Brown appearance",photoIds:["photo-2"]},analysisSha256:"a".repeat(64),reference:{lookupId:"scan",photoId:"photo-2",photoLabel:"close_up",photoAddedAt:when,scanSavedAt:when,sha256:"b".repeat(64),width:640,height:480,observedOn:null,vehicleContext:null}} };
}
const key = (store:string, owner="owner") => JSON.stringify([store,[owner,"scan"]]);
// Serial transaction fixture with staged writes: failure of draft retirement must
// roll back the paired history write. Native IndexedDB separately verifies browsers.
function databaseFixture() {
  const rows=new Map<string,unknown>(); let queue=Promise.resolve(); let hang=false, failStore:string|undefined, beforeRead:(()=>void)|undefined;
  const database={close:vi.fn(),transaction:vi.fn((stores:string[],mode:string)=>{
    let aborted=false;
    const writes=new Map<string,unknown>(), requests:Array<{key:string;request:{result:unknown;onsuccess:(()=>void)|null}}>=[];
    const tx={oncomplete:null as (()=>void)|null,onerror:null as (()=>void)|null,onabort:null as (()=>void)|null,
      abort:()=>{aborted=true;queueMicrotask(()=>tx.onabort?.());},
      objectStore:(store:string)=>{
        if(!stores.includes(store)) throw new Error("Store missing from transaction");
        return {get:(queryKey:unknown)=>{const request={result:undefined as unknown,onsuccess:null as (()=>void)|null};requests.push({key:JSON.stringify([store,queryKey]),request});return request;},
          put:(value:unknown,queryKey:unknown)=>{if(store===failStore) throw new Error("Synthetic quota failure");writes.set(JSON.stringify([store,queryKey]),structuredClone(value));}};
      }};
    queue=queue.then(()=>{
      if(hang)return;beforeRead?.();
      for(const {key:requestKey,request} of requests){if(aborted)return;request.result=structuredClone(rows.get(requestKey));request.onsuccess?.();}
      if(aborted)return;
      if(mode==="readwrite")for(const [writeKey,value]of writes)rows.set(writeKey,value);
      tx.oncomplete?.();
    });
    return tx;
  })};
  return {rows,database,fail:(store:string)=>{failStore=store;},hang:()=>{hang=true;},beforeRead:(action:()=>void)=>{beforeRead=action;}};
}
describe("atomic local observation-area history and recovery",()=>{
  let db:ReturnType<typeof databaseFixture>;
  beforeEach(()=>{vi.clearAllMocks();setActiveAccount("owner");db=databaseFixture();mocks.open.mockResolvedValue(db.database);vi.stubGlobal("BroadcastChannel",undefined);});
  afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
  async function save(value=draft(),previous:string|null=null){const saved=await writeObservationAreaDraft(getAccountScope(),"scan",previous,value);expect(saved.ok).toBe(true);if(!saved.ok||saved.raw===null)throw new Error("Fixture draft failed");return saved.raw;}
  it("reads missing history and draft without creating data",async()=>{
    expect(await readObservationAreas("scan")).toEqual([]);expect(await readObservationAreaDraft(getAccountScope(),"scan")).toEqual({ok:true,raw:null,draft:null,message:""});expect(db.rows.size).toBe(0);
  });
  it("commits exactly the saved draft and retires it in the same transaction",async()=>{
    const raw=await save(),guard=vi.fn();const committed=await commitObservationAreaDraft(getAccountScope(),"scan",raw,guard);
    expect(committed).toEqual({records:[observationAreaRecordFromDraft(draft())],record:observationAreaRecordFromDraft(draft()),raw:null});
    expect(guard).toHaveBeenCalledWith(draft().binding);expect(guard).toHaveBeenCalledTimes(1);
    expect(db.database.transaction).toHaveBeenLastCalledWith(["observation-areas","observation-area-drafts"],"readwrite");
    expect((await readObservationAreaDraft(getAccountScope(),"scan")).raw).toBeNull();
    expect(await readObservationAreas("scan")).toEqual(committed.records);
  });
  it("keeps both original draft and history if retirement fails after staging the history write",async()=>{
    const raw=await save();db.fail("observation-area-drafts");
    await expect(commitObservationAreaDraft(getAccountScope(),"scan",raw,()=>undefined)).rejects.toThrow("quota");
    expect(db.rows.has(key("observation-areas"))).toBe(false);expect(db.rows.get(key("observation-area-drafts"))).toBe(raw);
  });
  it("serializes competing draft saves so only one can replace the same observed raw",async()=>{
    const results=await Promise.all([writeObservationAreaDraft(getAccountScope(),"scan",null,draft(1)),writeObservationAreaDraft(getAccountScope(),"scan",null,draft(2))]);
    expect(results.filter((r)=>r.ok)).toHaveLength(1);expect(results.filter((r)=>!r.ok)).toHaveLength(1);
    expect((await readObservationAreaDraft(getAccountScope(),"scan")).draft?.id).toBe(id(1));
  });
  it("rejects stale source/account and asynchronous precommit guards without losing recovery",async()=>{
    const raw=await save();
    await expect(commitObservationAreaDraft(getAccountScope(),"scan",raw,()=>{throw new Error("Source changed");})).rejects.toThrow("Source changed");
    await expect(commitObservationAreaDraft(getAccountScope(),"scan",raw,async()=>undefined)).rejects.toThrow("synchronously");
    await expect(commitObservationAreaDraft(getAccountScope(),"scan",raw,async()=>{throw new Error("Async proof failed");})).rejects.toThrow("synchronously");
    expect(db.rows.get(key("observation-area-drafts"))).toBe(raw);expect(db.rows.has(key("observation-areas"))).toBe(false);
    await expect(commitObservationAreaDraft(getAccountScope(),"scan",raw,()=>setActiveAccount("other"))).rejects.toThrow("Account changed");
    expect(db.rows.get(key("observation-area-drafts"))).toBe(raw);
  });
  it("guards no-op retries and never retires a newer draft",async()=>{
    const raw=await save();await commitObservationAreaDraft(getAccountScope(),"scan",raw,()=>undefined);
    const guard=vi.fn();expect((await commitObservationAreaDraft(getAccountScope(),"scan",raw,guard)).records).toHaveLength(1);expect(guard).toHaveBeenCalledTimes(1);
    await expect(commitObservationAreaDraft(getAccountScope(),"scan",raw,()=>{throw new Error("Proof unavailable");})).rejects.toThrow("Proof unavailable");
    const newer=await save({...draft(2),binding:{...draft().binding,observation:{...draft().binding.observation,id:"other-claim"}}});
    await expect(commitObservationAreaDraft(getAccountScope(),"scan",raw,()=>undefined)).rejects.toThrow("Another view");
    expect(db.rows.get(key("observation-area-drafts"))).toBe(newer);expect(await readObservationAreas("scan")).toHaveLength(1);
  });
  it("allows edits but fences the draft binding, reserved ID/time, kind and parent",async()=>{
    const raw=await save();const edits={...draft(),notes:"Edited",rectangle:{...RECT,x:.2},updatedAt:"2026-11-06T00:01:00Z"};const next=await save(edits,raw);
    for(const patch of [{id:id(2)},{recordedAt:"2026-11-06T00:02:00Z"},{expectedHeadId:id(3)},{binding:{...draft().binding,analysisSha256:"c".repeat(64)}}]){
      expect(await writeObservationAreaDraft(getAccountScope(),"scan",next,{...edits,...patch})).toMatchObject({ok:false,message:expect.stringContaining("cannot be replaced")});
    }
    expect(await writeObservationAreaDraft(getAccountScope(),"scan",raw,null)).toMatchObject({ok:false});
    expect(db.rows.get(key("observation-area-drafts"))).toBe(next);
  });
  it("preserves corrupt raw recovery, rejects replacement, and permits only exact explicit discard",async()=>{
    db.rows.set(key("observation-area-drafts"),"{broken");const read=await readObservationAreaDraft(getAccountScope(),"scan");
    expect(read).toMatchObject({ok:true,raw:"{broken",draft:null,message:expect.stringContaining("Download")});
    expect(await writeObservationAreaDraft(getAccountScope(),"scan","{broken",draft())).toMatchObject({ok:false});
    expect(await writeObservationAreaDraft(getAccountScope(),"scan","other",null)).toMatchObject({ok:false});
    expect(await writeObservationAreaDraft(getAccountScope(),"scan","{broken",null)).toEqual({ok:true,raw:null});
  });
  it("does not overwrite unreadable history or a non-string draft",async()=>{
    const raw=await save();db.rows.set(key("observation-areas"),null);
    await expect(readObservationAreas("scan")).rejects.toThrow("invalid");
    await expect(commitObservationAreaDraft(getAccountScope(),"scan",raw,()=>undefined)).rejects.toThrow("invalid");
    expect(db.rows.get(key("observation-area-drafts"))).toBe(raw);
    db.rows.set(key("observation-area-drafts"),{corrupt:true});
    expect(await readObservationAreaDraft(getAccountScope(),"scan")).toMatchObject({ok:false});
    expect(await writeObservationAreaDraft(getAccountScope(),"scan",null,draft())).toMatchObject({ok:false});
  });
  it("requires exact current head for corrections and retains immutable retraction history",async()=>{
    const raw=await save();await commitObservationAreaDraft(getAccountScope(),"scan",raw,()=>undefined);
    const second={...draft(2),expectedHeadId:id(1),correctionReason:"Adjusted human area",rectangle:{...RECT,x:.2}};
    const raw2=await save(second);await commitObservationAreaDraft(getAccountScope(),"scan",raw2,()=>undefined);
    const stale={...draft(3),expectedHeadId:id(1),correctionReason:"Stale editor"};const raw3=await save(stale);
    await expect(commitObservationAreaDraft(getAccountScope(),"scan",raw3,()=>undefined)).rejects.toThrow("changed in another view");
    expect((await readObservationAreaDraft(getAccountScope(),"scan")).raw).toBe(raw3);
    await writeObservationAreaDraft(getAccountScope(),"scan",raw3,null);
    const withdrawn={...draft(4),kind:"retraction" as const,rectangle:null,expectedHeadId:id(2),correctionReason:"Withdraw area"};
    const raw4=await save(withdrawn);await commitObservationAreaDraft(getAccountScope(),"scan",raw4,()=>undefined);
    expect((await readObservationAreas("scan")).map((r)=>r.kind)).toEqual(["mark","mark","retraction"]);
  });
  it("rejects a second root and forked history without choosing a winner",async()=>{
    const first=observationAreaRecordFromDraft(draft())!;db.rows.set(key("observation-areas"),[first]);
    const raw=await save(draft(2));await expect(commitObservationAreaDraft(getAccountScope(),"scan",raw,()=>undefined)).rejects.toThrow("changed in another view");
    const left={...first,id:id(3),supersedesId:first.id,correctionReason:"Left"},right={...first,id:id(4),supersedesId:first.id,correctionReason:"Right"};
    db.rows.set(key("observation-areas"),[first,left,right]);
    expect(await readObservationAreas("scan")).toHaveLength(3);
    await writeObservationAreaDraft(getAccountScope(),"scan",raw,null);const retry=await save({...draft(5),expectedHeadId:left.id,correctionReason:"Choose fork"});
    await expect(commitObservationAreaDraft(getAccountScope(),"scan",retry,()=>undefined)).rejects.toThrow("conflicting corrections");
    expect((db.rows.get(key("observation-areas")) as ObservationAreaRecord[])).toHaveLength(3);
  });
  it("isolates accounts and stops account changes during either awaited open or fresh read",async()=>{
    await save();setActiveAccount("other");expect(await readObservationAreas("scan")).toEqual([]);expect((await readObservationAreaDraft(getAccountScope(),"scan")).draft).toBeNull();
    setActiveAccount("owner");const scope=getAccountScope();mocks.open.mockImplementation(async()=>{setActiveAccount("other");return db.database;});
    await expect(readObservationAreas("scan",scope)).rejects.toThrow("Account changed");
    setActiveAccount("owner");mocks.open.mockResolvedValue(db.database);db.beforeRead(()=>setActiveAccount("other"));
    await expect(readObservationAreas("scan")).rejects.toThrow("Account changed");
  });
  it("refuses history overflow without truncating entries or retiring recovery",async()=>{
    const records=Array.from({length:100},(_,i)=>observationAreaRecordFromDraft({...draft(i+1),binding:{...draft().binding,observation:{...draft().binding.observation,id:`claim-${i}`}}})!);
    db.rows.set(key("observation-areas"),records);const raw=await save(draft(101));
    await expect(commitObservationAreaDraft(getAccountScope(),"scan",raw,()=>undefined)).rejects.toThrow("exceeds 100 entries");
    expect(db.rows.get(key("observation-areas"))).toEqual(records);expect(db.rows.get(key("observation-area-drafts"))).toBe(raw);
  });
  it("notifies only the captured owner and preserves drafts on a bounded timeout",async()=>{
    const listener=vi.fn(),stop=subscribeObservationAreas(listener);const raw=await save();expect(listener).toHaveBeenCalledWith("scan");listener.mockClear();
    window.dispatchEvent(new CustomEvent(OBSERVATION_AREAS_CHANGED,{detail:{owner:"other",lookupId:"scan"}}));expect(listener).not.toHaveBeenCalled();stop();
    vi.useFakeTimers();db.hang();const pending=expect(commitObservationAreaDraft(getAccountScope(),"scan",raw,()=>undefined)).rejects.toThrow("stalled");
    await vi.advanceTimersByTimeAsync(15_001);await pending;expect(db.rows.get(key("observation-area-drafts"))).toBe(raw);expect(listener).not.toHaveBeenCalled();
  });
});
