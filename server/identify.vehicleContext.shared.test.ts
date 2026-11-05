import { createIdentifyResponse } from "./identify.shared";
import { confirmVehicleContextField } from "../src/lib/vehicleContext";
import type { ShopVehicleContext } from "../src/types";

const capturedAt = "2026-11-05T12:00:00.000Z";
const engine = `2.0 L ${"long engine variant ".repeat(5)}`.trim();
function vehicleContext(): ShopVehicleContext {
  let context: ShopVehicleContext = {
    year: "2018", make: "Honda", model: "Civic", engine,
    mileage: "123456", mileageUnit: "km", modifications: { status: "modified", details: "Aftermarket intake and exhaust" },
    customerName: "private-customer", plate: "private-plate", technicianName: "private-technician",
    bayOrRo: "private-ro", jobTitle: "private-job", notes: "private-notes", symptom: "Rough idle when cold",
  };
  for (const field of ["year", "engine", "mileage", "modifications"] as const) {
    context = confirmVehicleContextField(context, field, true, capturedAt);
  }
  return context;
}
const photos = ["overview", "close_up"].map((label, index) => ({ id: `photo-${index + 1}`, label, imageBase64: "data:image/jpeg;base64,aGVsbG8=" }));
const result = {
  partName: "Alternator", confidence: "medium", scanCategory: "electrical", whatItDoes: "Charges the battery.",
  visibleObservations: ["Vented housing is visible."], evidence: ["A pulley is visible."], concerns: [],
  safetyTriage: "can_help", isSafetyCritical: false, nextAction: "Read the part label before matching fitment.", needsBetterPhoto: false,
};
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const gemini = (text = JSON.stringify(result)) => json({ candidates: [{ content: { parts: [{ text }] } }] });
const flattenText = (body: Record<string, unknown>) => JSON.stringify(body);

describe("vehicle context reaches identification providers", () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.spyOn(console, "info").mockImplementation(() => undefined); vi.spyOn(console, "warn").mockImplementation(() => undefined); });

  it.each(["gemini", "gemini-rescue", "huggingface", "groq", "ollama"] as const)("preserves confirmed facts and privacy through %s", async (provider) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => provider === "ollama"
      ? json({ message: { content: JSON.stringify(result) } })
      : provider === "huggingface" || provider === "groq"
        ? json({ choices: [{ message: { content: JSON.stringify(result) } }] }) : gemini());
    if (provider === "gemini-rescue") fetchSpy.mockImplementationOnce(async () => gemini("not JSON"));
    const env = provider === "huggingface" ? { DEEPSPEC_ENABLE_HF_IDENTIFY_FALLBACK: "true", HF_TOKEN: "test-token" }
      : provider === "groq" ? { DEEPSPEC_ENABLE_GROQ_IDENTIFY_FALLBACK: "true", GROQ_API_KEY: "test-key" }
        : provider === "ollama" ? { DEEPSPEC_ENABLE_OLLAMA_IDENTIFY_FALLBACK: "true" } : { GEMINI_API_KEY: "test-key" };
    expect((await createIdentifyResponse({ photos, vehicleContext: vehicleContext() }, env)).status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(provider === "gemini-rescue" ? 2 : 1);
    for (const [, init] of fetchSpy.mock.calls) {
      const prompt = flattenText(JSON.parse(String(init?.body)));
      expect(prompt).toContain("Year: 2018 — user-confirmed (self-reported)");
      expect(prompt).toContain(`Engine: ${engine} — user-confirmed (self-reported)`);
      expect(prompt).toContain("Mileage: 123456 km — user-confirmed (self-reported)");
      expect(prompt).toContain("Modifications: Modified: Aftermarket intake and exhaust — user-confirmed (self-reported)");
      expect(prompt).toContain("Make: Honda — supplied, unconfirmed");
      expect(prompt).toContain("Rough idle when cold");
      expect(prompt).toContain("unconfirmed; not a visual observation");
      expect(prompt).toContain("do not establish exact part fitment, condition, serviceability or repair safety");
      expect(prompt).toContain("ask the user to confirm that detail");
      expect(prompt).not.toContain("private-");
    }
  });

  it("keeps legacy supplied facts unconfirmed and asks for missing details", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => gemini());
    await createIdentifyResponse({ imageBase64: photos[0].imageBase64, vehicleContext: { year: "2018", make: "Honda", mileage: "123456" } }, { GEMINI_API_KEY: "test-key" });
    const prompt = flattenText(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)));
    expect(prompt).toContain("Year: 2018 — supplied, unconfirmed");
    expect(prompt).toContain("Engine: Unknown — not confirmed");
    expect(prompt).toContain("Mileage: 123456 (unit unknown) — supplied, unconfirmed");
    expect(prompt).toContain("Modifications: Unknown — not confirmed");
    expect(prompt).not.toContain("— user-confirmed");
  });

  it("does not carry a confirmation onto a changed value or silently truncate it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => gemini());
    const changed = vehicleContext();
    changed.engine = "Different engine";
    changed.mileageUnit = "mi";
    changed.modifications = { status: "modified", details: "Different intake" };
    changed.model = "X".repeat(121);
    changed.confirmedFields = { ...changed.confirmedFields, model: { value: changed.model, confirmedAt: capturedAt } };
    await createIdentifyResponse({ photos, vehicleContext: changed }, { GEMINI_API_KEY: "test-key" });
    const prompt = flattenText(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)));
    expect(prompt).toContain("Engine: Different engine — supplied, unconfirmed");
    expect(prompt).toContain("Mileage: 123456 mi — supplied, unconfirmed");
    expect(prompt).toContain("Modifications: Modified: Different intake — supplied, unconfirmed");
    expect(prompt).toContain("Model: Unknown — not confirmed");
    expect(prompt).not.toContain(engine);
    expect(prompt).not.toContain("X".repeat(120));
  });

  it("still requests the relevant missing confirmation when no vehicle was supplied", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => gemini());
    await createIdentifyResponse({ imageBase64: photos[0].imageBase64 }, { GEMINI_API_KEY: "test-key" });
    const prompt = flattenText(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)));
    expect(prompt).toContain("Engine: Unknown — not confirmed");
    expect(prompt).toContain("ask the user to confirm that detail");
  });
});
