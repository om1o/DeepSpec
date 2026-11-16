import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createIdentifyResponse } from "../../server/identify.shared";
import { createChatResponse } from "../../server/chat.shared";
import { setActiveAccount } from "../lib/accountScope";
import { identifyCapturedFrame, sendFollowUpDetails } from "./aiService";
import { appendChatMessages, createChatMessage, createLookup, getLookup } from "./storage";

const fixtureResult = {
  partName: "Alternator", confidence: "medium", scanCategory: "electrical", candidateMatches: [],
  whatItDoes: "Charges the battery.", visibleObservations: ["Vented housing is visible."], evidenceRegions: [], concerns: [],
  safetyTriage: "can_help", isSafetyCritical: false, nextAction: "Photograph the alternator label straight on.",
  needsBetterPhoto: true, evidence: ["Vented housing and pulley."], sourceLinks: [],
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it("locally carries the fixture selection through a saved/reopened scan and both actual provider request builders", async () => {
  // This is request verification with a permitted generated fixture, not model-quality evidence.
  vi.stubEnv("VITE_SUPABASE_URL", "");
  vi.stubEnv("VITE_ENABLE_CLOUD_SYNC", "false");
  localStorage.clear();
  setActiveAccount("selected-flow-fixture");
  const bytes = readFileSync("public/test-fixtures/engine-scan-test.jpg");
  const frame = { imageBase64: `data:image/jpeg;base64,${bytes.toString("base64")}`, capturedAt: "2026-11-16T00:00:00.000Z" };
  const photos = [{ ...frame, id: "fixture-original", label: "overview" as const }];
  const selectedPart = { photoId: "fixture-original", rectangle: { x: 0.22, y: 0.65, width: 0.2, height: 0.19 } };
  const providerRequests: Array<{ contents: Array<{ parts: Array<{ text?: string; inline_data?: { data: string }; inlineData?: { data: string } }> }> }> = [];
  let identifying = false;
  const env = { GEMINI_API_KEY: "fixture-key", DEEPSPEC_ENABLE_CHAT: "true" };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
    const body = JSON.parse(String(options?.body));
    if (url === "/api/identify") {
      identifying = true;
      try {
        const response = await createIdentifyResponse(body, env);
        return new Response(JSON.stringify(response.body), { status: response.status });
      } finally { identifying = false; }
    }
    if (url === "/api/chat") {
      const response = await createChatResponse(body, env);
      return new Response(JSON.stringify(response.body), { status: response.status });
    }
    if (!String(url).startsWith("https://generativelanguage.googleapis.com/")) throw new Error("Unexpected external request in local fixture check");
    providerRequests.push(body);
    return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: identifying ? JSON.stringify(fixtureResult) : "Fixture reply only; no live model consulted." }] } }] }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  });
  const result = await identifyCapturedFrame(frame, undefined, undefined, { photos, selectedPart });
  const saved = createLookup({ frame, photos, selectedPart, result });
  expect(saved.ok).toBe(true);
  for (const question of ["What part is this?", "Can you tell its part number?"]) {
    const reopened = getLookup(saved.value.id)!;
    expect(reopened.selectedPart).toEqual(selectedPart);
    const answer = await sendFollowUpDetails(reopened, question);
    expect(appendChatMessages(reopened.id, [createChatMessage("user", question), createChatMessage("assistant", answer.message)]).ok).toBe(true);
  }
  expect(providerRequests).toHaveLength(3);
  for (const request of providerRequests) {
    const parts = request.contents[0].parts;
    expect(parts.map((part) => part.text ?? "").join("\n")).toContain(`Selected part reference: ${JSON.stringify(selectedPart)}`);
    const image = parts.find((part) => part.inline_data || part.inlineData)!;
    const submitted = Buffer.from((image.inline_data ?? image.inlineData)!.data, "base64");
    expect(createHash("sha256").update(submitted).digest("hex")).toBe(createHash("sha256").update(bytes).digest("hex"));
  }
  expect(providerRequests[1].contents[0].parts[0].text).toContain("User question: What part is this?");
  expect(providerRequests[2].contents[0].parts[0].text).toContain("User question: Can you tell its part number?");
  expect(getLookup(saved.value.id)?.chatHistory).toHaveLength(4);
});
