import { beforeEach, describe, expect, it } from "vitest";
import { accountStorageKey, setActiveAccount } from "../lib/accountScope";
import { createLookup, getLookup, LOOKUPS_STORAGE_KEY, readLookups, scanStateFromLookup, updateLookupVisualSelection, withRetriedLookupResult } from "./storage";
import type { ScanAnalysisState } from "../types";
const image = "data:image/jpeg;base64,YQ==";
const box = { x: 0.1, y: 0.1, width: 0.3, height: 0.4, confidence: 0.8 };
const state: ScanAnalysisState = {
  frame: { imageBase64: image, capturedAt: "2026-11-05T00:00:00Z" },
  photos: ["overview", "close_up", "marking"].map((label, index) => ({ id: `p${index}`, label: label as "overview", imageBase64: image, capturedAt: "2026-11-05T00:00:00Z" })),
  focusBox: box, focusMode: "mask", isolatedImageBase64: image,
  isolatedObjects: [
    { name: "Secondary", category: "electrical", primary: false, focusBox: box, isolatedImageBase64: image },
    { name: "Primary", category: "engine", primary: true, focusBox: box, isolatedImageBase64: image },
  ],
};
describe("durable visual evidence", () => {
  beforeEach(() => { localStorage.clear(); setActiveAccount("owner"); });
  it("retains all photos and secondary cutouts through save, normalization and reopen", () => {
    const saved = createLookup(state);
    expect(saved.ok).toBe(true);
    const reopened = scanStateFromLookup(getLookup(saved.value.id)!);
    expect(reopened.photos).toEqual(state.photos);
    expect(reopened.isolatedObjects).toEqual(state.isolatedObjects);
    expect(reopened.frame).toEqual(state.frame);
    const retried = withRetriedLookupResult(saved.value, { frame: state.frame, result: { partName: "Updated" } as NonNullable<ScanAnalysisState["result"]> });
    expect(retried.photos).toEqual(state.photos);
    expect(retried.isolatedObjects).toEqual(state.isolatedObjects);
  });
  it("corrects the displayed secondary index without changing original pixels or primary cutout", () => {
    const saved = createLookup(state).value;
    const nextBox = { ...box, x: 0.5 };
    expect(updateLookupVisualSelection(saved.id, nextBox, 1).ok).toBe(true);
    const reopened = getLookup(saved.id)!;
    expect(reopened.isolatedObjects?.[0]).toMatchObject({ name: "Secondary", focusBox: nextBox, focusMode: "crop", isolatedImageBase64: "", correctedAt: expect.any(String) });
    expect(reopened.isolatedObjects?.[1]).toEqual(state.isolatedObjects?.[1]);
    expect(reopened.isolatedImageBase64).toBe(image);
    expect(reopened.frame).toEqual(state.frame);
    expect(reopened.result).toEqual(saved.result);
  });
  it("primary correction clears both stale cutouts and survives reopen", () => {
    const saved = createLookup(state).value;
    expect(updateLookupVisualSelection(saved.id, box, 0).ok).toBe(true);
    const reopened = getLookup(saved.id)!;
    expect(reopened.isolatedImageBase64).toBe("");
    expect(reopened.focusMode).toBe("crop");
    expect(reopened.isolatedObjects?.[1]).toMatchObject({ focusMode: "crop", isolatedImageBase64: "" });
    expect(updateLookupVisualSelection(saved.id, box, 9)).toMatchObject({ ok: false });
    setActiveAccount("other");
    expect(updateLookupVisualSelection(saved.id, box, null)).toMatchObject({ ok: false, value: null });
  });
  it("refuses a malformed extra photo instead of silently discarding it on the next write", () => {
    const saved = createLookup(state).value;
    const raw = JSON.stringify([{ ...saved, photos: [...state.photos!, { id: "broken" }] }]);
    localStorage.setItem(accountStorageKey(LOOKUPS_STORAGE_KEY), raw);
    expect(readLookups().ok).toBe(false);
    expect(createLookup(state).ok).toBe(false);
    expect(localStorage.getItem(accountStorageKey(LOOKUPS_STORAGE_KEY))).toBe(raw);
  });
});
