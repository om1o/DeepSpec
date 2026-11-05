import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConditionAssessment, IdentificationResult } from "../src/types";
import { IDENTIFY_PIPELINE_VERSION, IDENTIFY_PROMPT_VERSION } from "../src/services/systemPrompts";
import { createIdentifyResponse, type IdentifyResponse } from "./identify.shared";

const photos = ["view-overview", "view-close"].map((id, index) => ({
  id, label: index === 0 ? "overview" : "close_up",
  imageBase64: `data:image/jpeg;base64,${Buffer.from(id).toString("base64")}`,
}));
const assessment = (photoId = photos[1].id): ConditionAssessment => ({
  version: 1,
  observations: [{ id: "surface", text: "Orange-brown patches are visible.", photoIds: [photoId], regionLabel: "lower edge" }],
  possibleCauses: [{ text: "Corrosion may explain the patches; its cause is not confirmed.", observationIds: ["surface"] }],
  unknowns: ["Remaining metal thickness and structural strength cannot be established from the photo."],
  nextEvidence: { kind: "photo", request: "Photograph the bracket mounting point from the side.", purpose: "Show whether the affected area reaches the mounting point.", photoIds: [photoId] },
});
const coreResult = {
  partName: "Bracket", confidence: "medium", scanCategory: "body", whatItDoes: "Supports a mounted component.",
  visibleObservations: ["Orange-brown patches are visible."], evidence: ["A metal bracket with mounting holes is visible."],
  evidenceRegions: [], candidateMatches: [], concerns: ["Discoloration is visible."],
  safetyTriage: "can_help", isSafetyCritical: false, needsBetterPhoto: false, sourceLinks: [],
  nextAction: "Read the label.", requiredNextEvidence: ["Read the label.", "Record the VIN."],
};
type Provider = "gemini" | "huggingface" | "groq" | "ollama";
const providers: Provider[] = ["gemini", "huggingface", "groq", "ollama"];
const providerEnv = (provider: Provider): Record<string, string> => {
  if (provider === "gemini") return { GEMINI_API_KEY: "test-key" };
  if (provider === "huggingface") return { DEEPSPEC_ENABLE_HF_IDENTIFY_FALLBACK: "true", HF_TOKEN: "test-key" };
  if (provider === "groq") return { DEEPSPEC_ENABLE_GROQ_IDENTIFY_FALLBACK: "true", GROQ_API_KEY: "test-key" };
  return { DEEPSPEC_ENABLE_OLLAMA_IDENTIFY_FALLBACK: "true" };
};
const providerResponse = (provider: Provider, result: unknown) => {
  const content = JSON.stringify(result);
  const body = provider === "gemini"
    ? { candidates: [{ content: { parts: [{ text: content }] } }] }
    : provider === "ollama" ? { message: { content } }
      : { choices: [{ message: { content } }] };
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
};
function readResult(response: IdentifyResponse): IdentificationResult {
  expect(response.status).toBe(200);
  if (!("result" in response.body)) throw new Error(`Expected an identification result: ${JSON.stringify(response.body)}`);
  return response.body.result;
}

describe("condition assessment provider contract", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(providers)("retains actual photo references and one coherent next action from %s", async (provider) => {
    const conditionAssessment = assessment();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => providerResponse(provider, { ...coreResult, conditionAssessment }));
    const response = await createIdentifyResponse({ photos }, providerEnv(provider));
    const result = readResult(response);
    expect(result.conditionAssessment).toEqual(conditionAssessment);
    expect(result.nextAction).toBe(conditionAssessment.nextEvidence?.request);
    expect(result.requiredNextEvidence).toEqual([conditionAssessment.nextEvidence?.request, ...coreResult.requiredNextEvidence]);
    expect(response.body).toMatchObject({ modelRun: { promptVersion: IDENTIFY_PROMPT_VERSION, pipelineVersion: IDENTIFY_PIPELINE_VERSION } });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const request = String(fetchSpy.mock.calls[0][1]?.body);
    expect(request).toContain("conditionAssessment");
    expect(request).toContain("unconfirmed");
    expect(request).toContain("human-confirmed");
    expect(request).toContain("view-close");
  });

  it.each(providers)("omits invalid grouped-photo evidence from %s without rejecting or retrying the core result", async (provider) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => providerResponse(provider, {
      ...coreResult, conditionAssessment: assessment("photo-1"),
    }));
    const result = readResult(await createIdentifyResponse({ photos }, providerEnv(provider)));
    expect(result.partName).toBe("Bracket");
    expect(result).not.toHaveProperty("conditionAssessment");
    expect(result.nextAction).toBe("Read the label.");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each(providers)("preserves legacy results with no assessment from %s", async (provider) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => providerResponse(provider, coreResult));
    const result = readResult(await createIdentifyResponse({ photos }, providerEnv(provider)));
    expect(result).not.toHaveProperty("conditionAssessment");
    expect(result.partName).toBe("Bracket");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])("validates Gemini rescue against the actual photo IDs (valid: %s)", async (valid) => {
    const conditionAssessment = assessment(valid ? photos[1].id : "photo-1");
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => providerResponse("gemini", {}))
      .mockImplementationOnce(async () => providerResponse("gemini", { ...coreResult, conditionAssessment }));
    const result = readResult(await createIdentifyResponse({ photos }, providerEnv("gemini")));
    if (valid) expect(result.conditionAssessment).toEqual(conditionAssessment);
    else expect(result).not.toHaveProperty("conditionAssessment");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const rescueRequest = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body));
    expect(rescueRequest.contents[0].parts.filter((part: Record<string, unknown>) => part.inline_data)).toHaveLength(2);
    expect(JSON.stringify(rescueRequest)).toContain("conditionAssessment");
    expect(JSON.stringify(rescueRequest)).toContain("view-close");
  });

  it.each(providers)("uses documented photo-1 only for actual legacy single-photo input on %s", async (provider) => {
    const conditionAssessment = assessment("photo-1");
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => providerResponse(provider, { ...coreResult, conditionAssessment }));
    const result = readResult(await createIdentifyResponse({ imageBase64: photos[0].imageBase64 }, providerEnv(provider)));
    expect(result.conditionAssessment).toEqual(conditionAssessment);
  });

  it("accepts photo-2 when a second legacy image was actually supplied", async () => {
    const conditionAssessment = assessment("photo-2");
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => providerResponse("gemini", { ...coreResult, conditionAssessment }));
    const result = readResult(await createIdentifyResponse({ imageBase64: photos[0].imageBase64, imageBase64_2: photos[1].imageBase64 }, providerEnv("gemini")));
    expect(result.conditionAssessment).toEqual(conditionAssessment);
  });

  it.each(["checked.", "checked by a qualified mechanic."])("retains a specific stop-driving action ending %s separately from the priority photo request", async (ending) => {
    const conditionAssessment = assessment();
    const safetyAction = `Do not drive until the cracked brake mounting bracket has been ${ending}`;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => providerResponse("gemini", {
      ...coreResult, partName: "Brake mounting bracket", scanCategory: "brakes",
      isSafetyCritical: true, safetyTriage: "needs_professional", nextAction: safetyAction, conditionAssessment,
    }));
    const result = readResult(await createIdentifyResponse({ photos }, providerEnv("gemini")));
    expect(result).toMatchObject({ isSafetyCritical: true, safetyTriage: "needs_professional", nextAction: safetyAction });
    expect(result.conditionAssessment?.nextEvidence?.request).toBe(conditionAssessment.nextEvidence?.request);
    expect(result.requiredNextEvidence).toEqual([conditionAssessment.nextEvidence?.request, ...coreResult.requiredNextEvidence]);
  });

  it("moves the priority evidence request first without duplicating it or dropping other requirements", async () => {
    const conditionAssessment = assessment();
    const request = conditionAssessment.nextEvidence!.request;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => providerResponse("gemini", {
      ...coreResult, conditionAssessment, requiredNextEvidence: ["Read the label.", request, "Record the VIN."],
    }));
    const result = readResult(await createIdentifyResponse({ photos }, providerEnv("gemini")));
    expect(result.requiredNextEvidence).toEqual([request, "Read the label.", "Record the VIN."]);
  });

  it("preserves an assessment from a compact result that needs legacy field normalization", async () => {
    const conditionAssessment = assessment();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => providerResponse("ollama", {
      partName: "Bracket", confidence: "medium", conditionAssessment,
    }));
    const result = readResult(await createIdentifyResponse({ photos }, providerEnv("ollama")));
    expect(result.conditionAssessment).toEqual(conditionAssessment);
    expect(result.nextAction).toBe(conditionAssessment.nextEvidence?.request);
  });

  it.each([
    { ...assessment(), version: "1" },
    { ...assessment(), observations: [assessment().observations[0], assessment().observations[0]] },
    { ...assessment(), possibleCauses: [{ text: "Possible corrosion.", observationIds: ["invented"] }] },
    { ...assessment(), nextEvidence: [assessment().nextEvidence] },
    "validation error: invalid optional block",
  ])("keeps the core answer when an optional assessment is malformed (%#)", async (conditionAssessment) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => providerResponse("gemini", { ...coreResult, conditionAssessment }));
    const result = readResult(await createIdentifyResponse({ photos }, providerEnv("gemini")));
    expect(result).not.toHaveProperty("conditionAssessment");
    expect(result.partName).toBe("Bracket");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
