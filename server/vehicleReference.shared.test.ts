import { afterEach, describe, expect, it, vi } from "vitest";
import { referenceAllowsSuggestions } from "../src/lib/vehicleReference";
import { createVehicleReferenceResponse, MAX_VEHICLE_REFERENCE_RESPONSE_BYTES, validateVehicleReferenceRequest, VEHICLE_REFERENCE_TIMEOUT_MS } from "./vehicleReference.shared";

// Synthetic transport fixtures only. No test sends a VIN to a live service.
const VIN = "1HGCM82633A004352";
const query = { vin: VIN, modelYear: 2003 };
const URL = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVINValuesBatch/";
const fixture = (changes: Record<string, unknown> = {}) => ({
  Count: 1,
  Results: [{ VIN, ModelYear: "2003", Make: "HONDA", Model: "Synthetic model", EngineModel: "Synthetic engine",
    EngineManufacturer: "Synthetic manufacturer", EngineCylinders: "4", DisplacementL: "2.4", FuelTypePrimary: "Gasoline",
    ErrorCode: "0", ErrorText: "0 - Synthetic clean decode", ...changes }],
});
const successfulFetch = (payload: unknown = fixture()) => vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
const unavailable = { status: 502, body: { error: { code: "vehicle_reference_unavailable" } } };

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("NHTSA vehicle reference transport", () => {
  it("posts only one VIN and the supplied year to a fixed official URL", async () => {
    const fetcher = successfulFetch();
    const result = await createVehicleReferenceResponse({ vin: ` ${VIN.toLowerCase()} `, modelYear: 2003 }, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(URL);
    expect(String(url)).not.toContain(VIN);
    expect(init).toMatchObject({ method: "POST", redirect: "error", credentials: "omit", cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" } });
    expect(Object.fromEntries(new URLSearchParams(init?.body as string))).toEqual({ data: `${VIN},2003`, format: "json" });
    expect(Object.keys(init?.headers ?? {})).toEqual(["Accept", "Content-Type"]);
    expect(result).toMatchObject({ status: 200, body: { reference: {
      version: 1, provider: "nhtsa-vpic", adapterVersion: "nhtsa-vpic-v1", sourceUrl: "https://vpic.nhtsa.dot.gov/api/", query,
      facts: { year: "2003", make: "HONDA", model: "Synthetic model", engineModel: "Synthetic engine", engineManufacturer: "Synthetic manufacturer", cylinders: "4", displacementL: "2.4", fuelType: "Gasoline" },
      decode: { codes: ["0"], messages: ["0 - Synthetic clean decode"] },
    } } });
    if (!("reference" in result.body)) throw new Error("Expected reference.");
    expect(result.body.reference.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(result.body.reference.retrievedAt).toISOString()).toBe(result.body.reference.retrievedAt);
    expect(referenceAllowsSuggestions(result.body.reference)).toBe(true);
  });

  it("omits the year rather than inventing one and retains no unrelated upstream fields", async () => {
    const fetcher = successfulFetch(fixture({ SuggestedVIN: "private corrected candidate", Customer: "private canary", PlantCountry: "JAPAN" }));
    const result = await createVehicleReferenceResponse({ vin: VIN }, fetcher);
    expect(new URLSearchParams(fetcher.mock.calls[0][1]?.body as string).get("data")).toBe(VIN);
    expect(JSON.stringify(result)).not.toContain("private");
    expect(JSON.stringify(result)).not.toContain("PlantCountry");
    expect(result).toMatchObject({ status: 200, body: { reference: { query: { vin: VIN } } } });
  });

  it.each([null, undefined, [], VIN, { vin: VIN, modelYear: "2003" }, { vin: VIN, modelYear: null },
    { vin: VIN, modelYear: 1980 }, { vin: VIN, modelYear: 2100 }, { vin: VIN, modelYear: 2003.5 },
    { vin: VIN, modelYear: NaN }, { vin: VIN, modelYear: Infinity }, { vin: VIN, url: "https://attacker.invalid" },
    { vin: VIN, symptom: "private" }, { vin: [VIN] }, { vin: `${VIN};${VIN}` }, { vin: "1HGCM8263*" },
    { vin: "1HGCM82633A00435I" }, { vin: "1HGCM82633A00435O" }, { vin: "1HGCM82633A00435Q" }])("rejects invalid or expanded requests without a network call: %j", async (body) => {
    const fetcher = successfulFetch();
    expect(validateVehicleReferenceRequest(body)?.status).toBe(400);
    expect(await createVehicleReferenceResponse(body, fetcher)).toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([1981, 2099])("accepts the supported supplied-year boundary %s", async (modelYear) => {
    const fetcher = successfulFetch(fixture({ ModelYear: String(modelYear) }));
    expect((await createVehicleReferenceResponse({ vin: VIN, modelYear }, fetcher)).status).toBe(200);
    expect(new URLSearchParams(fetcher.mock.calls[0][1]?.body as string).get("data")).toBe(`${VIN},${modelYear}`);
  });

  it("keeps nonzero and mixed decode codes and the exact warning text without declaring a clean decode", async () => {
    const warning = "  1 - Synthetic invalid check digit; 7 - incomplete identity.  ";
    const result = await createVehicleReferenceResponse(query, successfulFetch(fixture({ ErrorCode: "1, 7", ErrorText: warning })));
    expect(result).toMatchObject({ status: 200, body: { reference: { decode: { codes: ["1", "7"], messages: [warning] } } } });
    if (!("reference" in result.body)) throw new Error("Expected reference.");
    expect(referenceAllowsSuggestions(result.body.reference)).toBe(false);
  });

  it("preserves both official error text fields in source order without changing their text", async () => {
    const ErrorText = "  1 - Synthetic decode warning.  ";
    const AdditionalErrorText = "Additional synthetic detail:\ncheck the entered characters.\t";
    const result = await createVehicleReferenceResponse(query, successfulFetch(fixture({ ErrorCode: "1", ErrorText, AdditionalErrorText })));
    expect(result).toMatchObject({ status: 200, body: { reference: { decode: { codes: ["1"], messages: [ErrorText, AdditionalErrorText] } } } });
  });

  it("keeps an additional warning even when the main error text is missing", async () => {
    const AdditionalErrorText = "Synthetic supplementary warning with no main text.";
    const result = await createVehicleReferenceResponse(query, successfulFetch(fixture({ ErrorCode: undefined, ErrorText: undefined, AdditionalErrorText })));
    expect(result).toMatchObject({ status: 200, body: { reference: { decode: { codes: [], messages: [AdditionalErrorText] } } } });
    if (!("reference" in result.body)) throw new Error("Expected reference.");
    expect(referenceAllowsSuggestions(result.body.reference)).toBe(false);
  });

  it.each([undefined, null, "", "   "])("keeps absent additional warning text empty: %s", async (AdditionalErrorText) => {
    const result = await createVehicleReferenceResponse(query, successfulFetch(fixture({ AdditionalErrorText })));
    expect(result).toMatchObject({ status: 200, body: { reference: { decode: { messages: ["0 - Synthetic clean decode"] } } } });
  });

  it.each(["x".repeat(2001), { nested: "unexpected" }, 7, "\u0000"])("rejects malformed additional warning text without losing it silently: %#", async (AdditionalErrorText) => {
    expect(await createVehicleReferenceResponse(query, successfulFetch(fixture({ AdditionalErrorText })))).toMatchObject(unavailable);
  });

  it.each([undefined, null, ""])("does not infer a success code when status is absent: %s", async (ErrorCode) => {
    const result = await createVehicleReferenceResponse(query, successfulFetch(fixture({ ErrorCode, ErrorText: undefined })));
    expect(result).toMatchObject({ status: 200, body: { reference: { decode: { codes: [], messages: [] } } } });
    if (!("reference" in result.body)) throw new Error("Expected reference.");
    expect(referenceAllowsSuggestions(result.body.reference)).toBe(false);
  });

  it("leaves absent and Not Applicable facts unknown without constructing an engine code", async () => {
    const result = await createVehicleReferenceResponse(query, successfulFetch(fixture({ EngineModel: "Not Applicable", EngineManufacturer: null, Model: "", FuelTypePrimary: "N/A" })));
    expect(result).toMatchObject({ status: 200 });
    if (!("reference" in result.body)) throw new Error("Expected reference.");
    expect(result.body.reference.facts).toEqual({ year: "2003", make: "HONDA", cylinders: "4", displacementL: "2.4" });
  });

  it.each([{}, null, [], { Results: [] }, { Results: [fixture().Results[0], fixture().Results[0]] }, { Count: 2, Results: fixture().Results },
    { Results: [null] }, { Results: [{ VIN: "1HGCM82633A004353" }] }, { Results: [{ Make: "HONDA" }] },
    fixture({ VIN: [VIN] }), fixture({ Make: { nested: "value" } }), fixture({ Model: "x".repeat(121) }),
    fixture({ ErrorCode: "0;7" }), fixture({ ErrorCode: "0," }), fixture({ ErrorCode: 0 }), fixture({ ErrorCode: "1234" }),
    fixture({ ErrorCode: Array.from({ length: 33 }, (_, index) => String(index)).join(",") }),
    fixture({ ErrorText: "x".repeat(2001) }), fixture({ ErrorText: { private: "body" } })])("rejects malformed, oversized-field, or ambiguous results: %j", async (payload) => {
    const fetcher = successfulFetch(payload);
    expect(await createVehicleReferenceResponse(query, fetcher)).toMatchObject(unavailable);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([301, 302, 400, 429, 500])("returns a generic failure for upstream HTTP %s without retry or private error content", async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(`private upstream ${VIN}`, { status, headers: { "Content-Type": "application/json", Location: "https://attacker.invalid" } }));
    const result = await createVehicleReferenceResponse(query, fetcher);
    expect(result).toMatchObject(unavailable);
    expect(JSON.stringify(result)).not.toContain(VIN);
    expect(JSON.stringify(result)).not.toContain("private upstream");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects an already-redirected response even if a fetch implementation ignores redirect:error", async () => {
    const response = Response.json(fixture());
    Object.defineProperty(response, "redirected", { value: true });
    expect(await createVehicleReferenceResponse(query, vi.fn<typeof fetch>().mockResolvedValue(response))).toMatchObject(unavailable);
  });

  it.each([
    () => new Response("<html>private response</html>", { headers: { "Content-Type": "text/html" } }),
    () => new Response("{broken", { headers: { "Content-Type": "application/json" } }),
    () => new Response(new Uint8Array([0xff, 0xfe]), { headers: { "Content-Type": "application/json" } }),
    () => new Response(null, { headers: { "Content-Type": "application/json" } }),
  ])("rejects unexpected format, malformed JSON, invalid UTF8, or an absent body", async (response) => {
    expect(await createVehicleReferenceResponse(query, vi.fn<typeof fetch>().mockResolvedValue(response()))).toMatchObject(unavailable);
  });

  it("enforces the actual streaming byte cap when Content-Length is absent or misleading", async () => {
    for (const contentLength of [undefined, "1"]) {
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new Uint8Array(MAX_VEHICLE_REFERENCE_RESPONSE_BYTES)); controller.enqueue(new Uint8Array([1])); }, cancel,
      });
      const response = new Response(body, { headers: { "Content-Type": "application/json", ...(contentLength ? { "Content-Length": contentLength } : {}) } });
      expect(await createVehicleReferenceResponse(query, vi.fn<typeof fetch>().mockResolvedValue(response))).toMatchObject(unavailable);
      expect(cancel).toHaveBeenCalled();
    }
  });

  it("rejects an advertised oversized body before reading it", async () => {
    const response = Response.json(fixture(), { headers: { "Content-Length": String(MAX_VEHICLE_REFERENCE_RESPONSE_BYTES + 1) } });
    const reader = vi.spyOn(response.body!, "getReader");
    expect(await createVehicleReferenceResponse(query, vi.fn<typeof fetch>().mockResolvedValue(response))).toMatchObject(unavailable);
    expect(reader).not.toHaveBeenCalled();
  });

  it("accepts an exactly bounded JSON body", async () => {
    const original = JSON.stringify(fixture());
    const response = new Response(original.padEnd(MAX_VEHICLE_REFERENCE_RESPONSE_BYTES, " "), { headers: { "Content-Type": "application/json" } });
    expect((await createVehicleReferenceResponse(query, vi.fn<typeof fetch>().mockResolvedValue(response))).status).toBe(200);
  });

  it("bounds a hanging fetch, aborts it and does not retry", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {}));
    const pending = createVehicleReferenceResponse(query, fetcher);
    await vi.advanceTimersByTimeAsync(VEHICLE_REFERENCE_TIMEOUT_MS);
    expect(await pending).toMatchObject({ status: 504, body: { error: { code: "vehicle_reference_timeout" } } });
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the same deadline through a stalled response body and cancels its reader", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => resolve(new Response(new ReadableStream({ cancel }), { headers: { "Content-Type": "application/json" } })), 9_000);
    }));
    const pending = createVehicleReferenceResponse(query, fetcher);
    await vi.advanceTimersByTimeAsync(VEHICLE_REFERENCE_TIMEOUT_MS);
    expect(await pending).toMatchObject({ status: 504 });
    expect(cancel).toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never logs VINs, upstream errors or response bodies", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error(`private provider URL /${VIN}?token=canary`));
    const result = await createVehicleReferenceResponse(query, fetcher);
    expect(result).toMatchObject(unavailable);
    expect(JSON.stringify(result)).not.toContain(VIN);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
