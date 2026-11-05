import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccountScope, setActiveAccount } from "./accountScope";
import { visualSelectionSourceMatches } from "./visualSelection";
import type { ScanAnalysisState } from "../types";

describe("visual selection source matching", () => {
  const origin = "https://selection-test.supabase.co";
  const owner = "owned-user", lookupId = "saved-scan";
  const context = { lookupId };
  const path = `/storage/v1/object/sign/scan-images/${owner}/${lookupId}/original-hash.jpg`;
  const signed = (token: string, assetPath = path, args = "") => `${origin}${assetPath}?token=${token}${args}`;
  const snapshot = (image: string): ScanAnalysisState => ({
    frame: { imageBase64: image, capturedAt: "2026-11-05T12:00:00.000Z" },
    analysisAttemptId: "original-analysis", analyzedAt: "2026-11-05T12:00:01.000Z",
  });

  beforeEach(() => {
    setActiveAccount(owner);
    vi.stubEnv("VITE_SUPABASE_URL", origin);
  });
  afterEach(() => { vi.unstubAllEnvs(); setActiveAccount(null); });

  it("permits token renewal for the same owned original, photo and cutout references", () => {
    const source = (token: string): ScanAnalysisState => ({
      ...snapshot(signed(token)),
      photos: [{ id: "photo-1", label: "overview", ...snapshot(signed(token)).frame }],
      focusBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4, confidence: 0.7 },
      focusMode: "mask", isolatedImageBase64: signed(token, path.replace("original-hash.jpg", "isolated-hash.png")),
      isolatedObjects: [{ name: "Bracket", category: "engine", primary: true,
        focusBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4, confidence: 0.7 }, focusMode: "mask",
        isolatedImageBase64: signed(token, path.replace("original-hash.jpg", "isolated-hash.png")) }],
    });
    expect(visualSelectionSourceMatches(source("old-token"), source("renewed-token"), context)).toBe(true);
    expect(visualSelectionSourceMatches(source("old-token"), source("renewed-token"))).toBe(false);
  });

  it.each([
    ["different owner", path.replace(owner, "other-user")],
    ["different scan", path.replace(lookupId, "other-scan")],
    ["different bucket", path.replace("scan-images", "other-bucket")],
    ["transformed image", path.replace("object/sign", "render/image/sign")],
    ["public object", path.replace("object/sign", "object/public")],
    ["missing asset", path.slice(0, path.lastIndexOf("/") + 1)],
    ["encoded separator", path.replace("original-hash.jpg", "nested%2Fimage.jpg")],
    ["normalized traversal", path.replace("original-hash.jpg", "extra/../original-hash.jpg")],
    ["encoded traversal", path.replace("original-hash.jpg", "%2E%2E/original-hash.jpg")],
  ])("does not relax token equality for %s", (_name, assetPath) => {
    expect(visualSelectionSourceMatches(snapshot(signed("old", assetPath)), snapshot(signed("new", assetPath)), context)).toBe(false);
  });

  it("rejects a different asset path even within the current owner's scan", () => {
    expect(visualSelectionSourceMatches(snapshot(signed("old")), snapshot(signed("new", path.replace("original-hash.jpg", "photo-other.jpg"))), context)).toBe(false);
  });

  it.each(["width=300", "height=200", "format=webp", "download=changed.jpg", "custom=changed"])("preserves non-token argument %s", (argument) => {
    expect(visualSelectionSourceMatches(snapshot(signed("old", path, `&${argument}`)), snapshot(signed("new", path, `&${argument}`)), context)).toBe(true);
    expect(visualSelectionSourceMatches(snapshot(signed("old")), snapshot(signed("new", path, `&${argument}`)), context)).toBe(false);
    expect(visualSelectionSourceMatches(snapshot(signed("old", path, "&width=200")), snapshot(signed("new", path, "&width=300")), context)).toBe(false);
  });

  it.each(["", "&token=second", "#fragment"])("rejects missing, ambiguous or fragmented tokens (%s)", (suffix) => {
    const first = suffix === "" ? `${origin}${path}` : signed("old") + suffix;
    const second = suffix === "" ? signed("new") : signed("new") + suffix;
    expect(visualSelectionSourceMatches(snapshot(first), snapshot(second), context)).toBe(false);
  });

  it("rejects empty tokens and token changes on foreign or unconfigured origins", () => {
    expect(visualSelectionSourceMatches(snapshot(signed("")), snapshot(signed("new")), context)).toBe(false);
    const foreign = (token: string) => signed(token).replace(origin, "https://unrelated.example");
    expect(visualSelectionSourceMatches(snapshot(foreign("old")), snapshot(foreign("new")), context)).toBe(false);
    vi.stubEnv("VITE_SUPABASE_URL", "https://different-project.supabase.co");
    expect(visualSelectionSourceMatches(snapshot(signed("old")), snapshot(signed("new")), context)).toBe(false);
    vi.stubEnv("VITE_SUPABASE_URL", "");
    expect(visualSelectionSourceMatches(snapshot(signed("old")), snapshot(signed("new")), context)).toBe(false);
  });

  it("requires the current account and exact lookup context", () => {
    const scope = getAccountScope();
    expect(visualSelectionSourceMatches(snapshot(signed("old")), snapshot(signed("new")), { lookupId: "other-scan" })).toBe(false);
    setActiveAccount("other-user");
    expect(visualSelectionSourceMatches(snapshot(signed("old")), snapshot(signed("new")), context)).toBe(false);
    setActiveAccount(owner);
    expect(visualSelectionSourceMatches(snapshot(signed("old")), snapshot(signed("new")), { lookupId, scope })).toBe(false);
    setActiveAccount(null);
    expect(visualSelectionSourceMatches(snapshot(signed("old")), snapshot(signed("new")), context)).toBe(false);
  });

  it("keeps data images and arbitrary external URLs exact", () => {
    for (const image of ["data:image/jpeg;base64,YQ==", "https://external.example/image.jpg?token=old"]) {
      expect(visualSelectionSourceMatches(snapshot(image), snapshot(image), context)).toBe(true);
    }
    expect(visualSelectionSourceMatches(snapshot("data:image/jpeg;base64,YQ=="), snapshot("data:image/jpeg;base64,Yg=="), context)).toBe(false);
    expect(visualSelectionSourceMatches(snapshot("https://external.example/image.jpg?token=old"), snapshot("https://external.example/image.jpg?token=new"), context)).toBe(false);
  });

  it("does not let token renewal hide changed photo or selection metadata", () => {
    const original = { ...snapshot(signed("old")), focusBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.4, confidence: 0.7 } };
    expect(visualSelectionSourceMatches(original, { ...snapshot(signed("new")), focusBox: { ...original.focusBox, x: 0.2 } }, context)).toBe(false);
    expect(visualSelectionSourceMatches(original, { ...original, frame: { ...snapshot(signed("new")).frame, capturedAt: "2026-11-05T12:00:02.000Z" } }, context)).toBe(false);
    expect(visualSelectionSourceMatches(original, { ...original, frame: snapshot(signed("new")).frame, analysisAttemptId: "other-analysis" }, context)).toBe(false);
  });

  it("does not relax insecure, credentialed or malformed URL forms", () => {
    for (const modify of [
      (url: string) => url.replace("https:", "http:"),
      (url: string) => url.replace("https://", "https://username@"),
      (url: string) => `${url} `,
      (url: string) => url.replace("original-hash.jpg", "bad%25path.jpg"),
    ]) expect(visualSelectionSourceMatches(snapshot(modify(signed("old"))), snapshot(modify(signed("new"))), context)).toBe(false);
  });
});
