import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountScope, isAccountScopeCurrent, setActiveAccount } from "../lib/accountScope";
import { mergeServiceRecords } from "../lib/serviceRecord";
import type { ServiceRecord } from "../types/serviceRecord";
const mocks = vi.hoisted(() => ({ client: vi.fn(), import: vi.fn() }));
vi.mock("./auth", () => ({ getAuthClient: mocks.client }));
vi.mock("./serviceRecordStore", () => ({ importServiceRecords: mocks.import }));
import { readCloudServiceRecords, syncServiceRecords } from "./serviceRecordCloud";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function record(n = 1): ServiceRecord {
  return { version: 1, id: id(n), lookupId: "scan", recordedAt: "2026-11-05T00:00:00Z", occurredOn: null,
    recordedBy: "Pat", basis: "personally_performed", subject: "Bracket", photoIds: ["photo-1"], notes: "Human evidence",
    kind: "repair", action: "Cleaned surface", status: "completed", parts: "None" };
}
type Row = { id: string; user_id: string; lookup_id: string; record_json: ServiceRecord };
const row = (value: ServiceRecord): Row => ({ id: value.id, user_id: "owner", lookup_id: value.lookupId, record_json: value });
type Response = { data: unknown; error: { code: string; message?: string } | null };

describe("immutable owner-scoped human record sync", () => {
  let local: ServiceRecord[], remote: Row[];
  let parentExists: boolean;
  let insert: ReturnType<typeof vi.fn>;
  let user: { id: string; email_confirmed_at?: string; is_anonymous?: boolean };
  let getUser: ReturnType<typeof vi.fn>;
  let readOverride: (() => Response | Promise<Response>) | undefined;
  let insertOverride: ((value: Row) => Response | Promise<Response>) | undefined;
  let filters: Array<[string,unknown]>;
  let pages: number;
  beforeEach(() => {
    vi.clearAllMocks(); setActiveAccount("owner"); local = [record()]; remote = []; parentExists = true; filters = []; pages = 0;
    user = { id: "owner", email_confirmed_at: "2026-11-05T00:00:00Z" }; readOverride = undefined; insertOverride = undefined;
    getUser = vi.fn(async () => ({ data: { user }, error: null }));
    insert = vi.fn(async (value: Row): Promise<Response> => {
      if (insertOverride) return insertOverride(value);
      if (remote.some((entry) => entry.id === value.id && entry.user_id === value.user_id)) return { data: null, error: { code: "23505" } };
      remote.push(structuredClone(value)); return { data: structuredClone(value), error: null };
    });
    const query = (table: string, payload?: Row) => {
      const equal = new Map<string,unknown>(); let after: string | undefined, limit = 25;
      const run = async (): Promise<Response> => {
        if (payload) return insert(payload);
        if (table === "scan_lookups") return { data: parentExists ? { local_id: "scan" } : null, error: null };
        if (equal.has("id")) return { data: structuredClone(remote.find((entry) => entry.id === equal.get("id") && entry.user_id === equal.get("user_id")) ?? null), error: null };
        pages += 1;
        if (readOverride) return readOverride();
        return { data: structuredClone(remote.filter((entry) => entry.user_id === equal.get("user_id") && entry.lookup_id === equal.get("lookup_id") && (!after || entry.id > after)).sort((a,b) => a.id.localeCompare(b.id)).slice(0,limit)), error: null };
      };
      const chain = {
        eq: (key: string, value: unknown) => { filters.push([key,value]); equal.set(key,value); return chain; },
        gt: (_key: string, value: string) => { after = value; return chain; },
        order: () => chain, limit: (value: number) => { limit = value; return chain; },
        select: () => chain, abortSignal: () => chain, maybeSingle: run,
        then: (resolve: (value: Response) => unknown, reject: (reason: unknown) => unknown) => run().then(resolve,reject),
      };
      return chain;
    };
    mocks.client.mockResolvedValue({ auth: { getUser }, from: (table: string) => ({ select: () => query(table), insert: (value: Row) => query(table,value) }) });
    mocks.import.mockImplementation(async (lookupId, records, scope) => {
      if (!isAccountScopeCurrent(scope)) throw new Error("Account changed");
      local = mergeServiceRecords(local,records,lookupId); return structuredClone(local);
    });
  });
  afterEach(() => vi.useRealTimers());

  it("reads every owner page without importing or uploading", async () => {
    remote = Array.from({length:26},(_,index) => row(record(index + 1)));
    remote.push({ ...row(record(50)), user_id: "other" }, { ...row(record(51)), lookup_id: "different" });
    expect(await readCloudServiceRecords("scan")).toHaveLength(26); expect(pages).toBe(2);
    expect(filters).toEqual(expect.arrayContaining([["user_id","owner"],["lookup_id","scan"]]));
    expect(mocks.import).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled();
  });
  it("uploads references before dependants even when device times sort the correction first", async () => {
    const correction = { ...record(2), recordedAt: "2026-11-04T00:00:00Z", supersedesId: id(1), correctionReason: "Corrected account of work" };
    local = [correction,record()];
    expect(await syncServiceRecords("scan")).toMatchObject({synced:2});
    expect(insert.mock.calls.map(([value]) => value.id)).toEqual([id(1),id(2)]);
    expect(remote).toHaveLength(2); expect(local).toHaveLength(2);
  });
  it("does not create a parent or import anything when the owned scan is not cloud-saved", async () => {
    parentExists = false;
    await expect(syncServiceRecords("scan")).rejects.toThrow("Save this scan to the cloud first");
    expect(insert).not.toHaveBeenCalled(); expect(mocks.import).not.toHaveBeenCalled(); expect(local).toEqual([record()]);
  });
  it("returns zero new uploads when existing remote IDs have identical content", async () => {
    remote = [row(record())];
    expect(await syncServiceRecords("scan")).toMatchObject({synced:0,message:expect.stringContaining("Cloud confirmed 1")});
    expect(insert).not.toHaveBeenCalled();
  });
  it("treats a concurrent duplicate insert as success only after fetching identical immutable content", async () => {
    insertOverride = (value) => { remote.push(structuredClone(value)); return { data:null,error:{code:"23505"} }; };
    expect(await syncServiceRecords("scan")).toMatchObject({synced:1});
    expect(filters).toContainEqual(["id",id(1)]); expect(local).toEqual([record()]);
  });
  it("rejects a duplicate ID with changed content and preserves the device version", async () => {
    insertOverride = (value) => { remote.push({...structuredClone(value),record_json:{...value.record_json,notes:"Other version"}}); return {data:null,error:{code:"23505"}}; };
    await expect(syncServiceRecords("scan")).rejects.toThrow("conflicting content");
    expect(local[0].notes).toBe("Human evidence"); expect(remote[0].record_json.notes).toBe("Other version");
  });
  it("preserves a local append during upload without claiming the later entry was synced", async () => {
    insertOverride = (value) => { local.push(record(2)); remote.push(structuredClone(value)); return { data:value,error:null }; };
    const result = await syncServiceRecords("scan");
    expect(local.map((entry) => entry.id)).toEqual([id(1),id(2)]); expect(remote).toHaveLength(1);
    expect(result.message).toContain("Later device records require another sync");
  });
  it("unions valid cloud correction forks without choosing a timestamp winner", async () => {
    const left = {...record(2),supersedesId:id(1),correctionReason:"Local correction"};
    const right = {...record(3),supersedesId:id(1),correctionReason:"Cloud correction"};
    local = [record(),left]; remote = [row(record()),row(right)];
    await syncServiceRecords("scan"); expect(local).toHaveLength(3); expect(remote).toHaveLength(3);
  });
  it.each(["owner","lookup","id","references"])("rejects invalid %s cloud metadata without importing it", async (kind) => {
    const value = row(record());
    if (kind === "owner") value.user_id = "other";
    if (kind === "lookup") value.lookup_id = "other";
    if (kind === "id") value.id = id(2);
    if (kind === "references") value.record_json = {...record(),supersedesId:id(2),correctionReason:"Missing parent"};
    readOverride = () => ({data:[value],error:null});
    await expect(readCloudServiceRecords("scan")).rejects.toThrow("invalid"); expect(mocks.import).not.toHaveBeenCalled();
  });
  it("rejects histories beyond 100 entries rather than returning a truncated prefix", async () => {
    remote = Array.from({length:101},(_,index) => row(record(index+1)));
    await expect(readCloudServiceRecords("scan")).rejects.toThrow("exceed"); expect(pages).toBe(5);
  });
  it.each(["mismatch","anonymous","unverified"])("requires a verified owner (%s)", async (kind) => {
    if (kind === "mismatch") user.id = "other";
    if (kind === "anonymous") user.is_anonymous = true;
    if (kind === "unverified") delete user.email_confirmed_at;
    await expect(syncServiceRecords("scan")).rejects.toThrow("verified account"); expect(insert).not.toHaveBeenCalled(); expect(pages).toBe(0);
  });
  it("ignores a response after account change and supports cancellation of read-only requests", async () => {
    const scope = getAccountScope();
    readOverride = () => { setActiveAccount("other"); return {data:[row(record())],error:null}; };
    await expect(readCloudServiceRecords("scan",scope)).rejects.toThrow("Account changed"); expect(mocks.import).not.toHaveBeenCalled();
    setActiveAccount("owner"); const controller = new AbortController(); controller.abort();
    await expect(readCloudServiceRecords("scan",getAccountScope(),controller.signal)).rejects.toThrow("canceled");
  });
  it("bounds a hung auth verification without starting writes", async () => {
    vi.useFakeTimers(); getUser.mockReturnValue(new Promise(() => undefined));
    const pending = expect(syncServiceRecords("scan")).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(20_001); await pending;
    expect(insert).not.toHaveBeenCalled(); expect(mocks.import).not.toHaveBeenCalled();
  });
  it("reports unapplied schema and foreign-key failures without exposing provider error text", async () => {
    readOverride = () => ({data:null,error:{code:"42P01",message:"secret internal URL"}});
    await expect(readCloudServiceRecords("scan")).rejects.toThrow("database migration");
    readOverride = undefined; insertOverride = () => ({data:null,error:{code:"23503",message:"secret internal URL"}});
    await expect(syncServiceRecords("scan")).rejects.toThrow("Save this scan to the cloud first");
  });
});
