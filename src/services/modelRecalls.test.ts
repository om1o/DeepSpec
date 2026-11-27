import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountScope, setActiveAccount } from "../lib/accountScope";
import { MAX_MODEL_RECALL_RESPONSE_BYTES, MODEL_RECALL_TIMEOUT_MS, modelRecallSourceUrl, normalizeModelRecallQuery, requestModelRecalls } from "./modelRecalls";

const vehicle = { year: "2012", make: "Acura", model: "RDX", vin: "1HGCM82633A004352" };
const campaign = {
  NHTSACampaignNumber: "19V182000", Component: "AIR BAGS", Summary: "A model-wide inflator recall.",
  Consequence: "The inflator could rupture.", Remedy: "Contact a dealer.", ModelYear: "2012", Make: "ACURA", Model: "RDX",
};
const payload = (results: unknown[] = [campaign]) => ({ Count: results.length, results });
const response = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), {
  status: 200, headers: { "Content-Type": "application/json;charset=UTF-8", ...headers },
});

describe("NHTSA model recall lookup", () => {
  beforeEach(() => setActiveAccount("recall-test-user"));
  afterEach(() => { vi.useRealTimers(); setActiveAccount(null); vi.restoreAllMocks(); });

  it("requires a bounded year, make, and model and never needs the VIN", async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(normalizeModelRecallQuery({ year: "2012", make: " Acura ", model: " RDX " })).toEqual({ year: 2012, make: "Acura", model: "RDX" });
    expect(normalizeModelRecallQuery({ ...vehicle, model: " " })).toBeNull();
    expect(normalizeModelRecallQuery({ ...vehicle, year: "2099" })).toBeNull();
    await expect(requestModelRecalls({ ...vehicle, model: " " }, getAccountScope(), fetcher)).rejects.toThrow("valid year, make, and model");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["make", "model"] as const)("does not send a VIN pasted into %s", async (field) => {
    const fetcher = vi.fn<typeof fetch>();
    const pasted = { ...vehicle, [field]: `${vehicle[field]} ${vehicle.vin}` };
    expect(normalizeModelRecallQuery(pasted)).toBeNull();
    await expect(requestModelRecalls(pasted, getAccountScope(), fetcher)).rejects.toThrow("valid year, make, and model");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("uses an explicit single GET without a VIN and preserves model-wide provenance", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(payload()));
    const result = await requestModelRecalls(vehicle, getAccountScope(), fetcher);
    expect(result).toMatchObject({ query: { year: 2012, make: "Acura", model: "RDX" }, recalls: [{ campaignNumber: "19V182000", component: "AIR BAGS" }] });
    expect(result.retrievedAt).toBeTruthy();
    expect(result.sourceUrl).toBe(modelRecallSourceUrl(result.query));
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toContain("api.nhtsa.gov/recalls/recallsByVehicle?");
    expect(url).not.toContain(vehicle.vin);
    expect(init).toMatchObject({ method: "GET", credentials: "omit", cache: "no-store", redirect: "error" });
  });

  it("returns an empty model list without claiming VIN clearance", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(payload([])));
    await expect(requestModelRecalls(vehicle, getAccountScope(), fetcher)).resolves.toMatchObject({ recalls: [] });
  });

  it("keeps a campaign when NHTSA leaves optional narrative fields blank", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(payload([{ ...campaign, Consequence: null, Remedy: " " }])));
    await expect(requestModelRecalls(vehicle, getAccountScope(), fetcher)).resolves.toMatchObject({
      recalls: [{ campaignNumber: "19V182000", consequence: "", remedy: "" }],
    });
  });

  it("matches NHTSA names independently of the device locale", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(payload([{ ...campaign, Make: "INFINITI", Model: "G37" }])));
    const localeLower = String.prototype.toLocaleLowerCase;
    vi.spyOn(String.prototype, "toLocaleLowerCase").mockImplementation(function (this: string, locales?: string | string[]) {
      return localeLower.call(this, locales ?? "tr");
    });
    await expect(requestModelRecalls({ year: "2012", make: "Infiniti", model: "G37" }, getAccountScope(), fetcher))
      .resolves.toMatchObject({ recalls: [{ campaignNumber: "19V182000" }] });
  });

  it.each([
    payload([{ ...campaign, Model: "MDX" }]),
    { Count: 2, results: [campaign] },
    payload([{ ...campaign, NHTSACampaignNumber: "bad" }]),
  ])("rejects mismatched or malformed campaign data", async (bad) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(bad));
    await expect(requestModelRecalls(vehicle, getAccountScope(), fetcher)).rejects.toThrow("unavailable");
  });

  it("bounds the response and handles rate limiting", async () => {
    const tooLarge = vi.fn<typeof fetch>().mockResolvedValue(response(payload(), { "Content-Length": String(MAX_MODEL_RECALL_RESPONSE_BYTES + 1) }));
    await expect(requestModelRecalls(vehicle, getAccountScope(), tooLarge)).rejects.toThrow("unavailable");
    const limited = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429 }));
    await expect(requestModelRecalls(vehicle, getAccountScope(), limited)).rejects.toThrow("limiting recall lookups");
  });

  it("times out a provider that does not respond", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => undefined));
    const pending = requestModelRecalls(vehicle, getAccountScope(), fetcher);
    const assertion = expect(pending).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(MODEL_RECALL_TIMEOUT_MS);
    await assertion;
  });

  it("does not show a response after account scope changes", async () => {
    let resolve!: (value: Response) => void;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise((yes) => { resolve = yes; }));
    const pending = requestModelRecalls(vehicle, getAccountScope(), fetcher);
    setActiveAccount("different-user");
    resolve(response(payload()));
    await expect(pending).rejects.toThrow("Account changed");
  });
});
