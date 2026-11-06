import { describe, expect, it } from "vitest";
import type { ConditionAssessment } from "../types";
import { normalizeConditionAssessment } from "./conditionAssessment";

const allowedPhotos = ["overview-1", "close-up-2"];
const assessment = (): ConditionAssessment => ({
  version: 1,
  observations: [
    { id: "surface", text: "Orange-brown discoloration is visible.", photoIds: ["overview-1", "close-up-2"], regionLabel: "lower edge" },
    { id: "flaking", text: "The close view shows flaking material.", photoIds: ["close-up-2"] },
  ],
  possibleCauses: [{ text: "Corrosion may explain the discoloration and flaking.", observationIds: ["surface", "flaking"] }],
  unknowns: ["The images do not establish remaining metal thickness or structural strength."],
  nextEvidence: { kind: "photo", request: "Photograph the mounting area from the side.", purpose: "Show how the affected area connects to the structure.", photoIds: ["overview-1"] },
});

describe("normalizeConditionAssessment", () => {
  it("retains links to the actual photos and observations without mutating the input", () => {
    const input = assessment();
    input.observations[0].text = `  ${input.observations[0].text}  `;
    const normalized = normalizeConditionAssessment(input, allowedPhotos);
    expect(normalized).toEqual(assessment());
    expect(input.observations[0].text).toMatch(/^ {2}/);
    expect(normalized?.observations).not.toBe(input.observations);
    expect(normalized?.observations[0].photoIds).not.toBe(input.observations[0].photoIds);
  });

  it("does not invent causes, unknowns, a next request, or a legacy photo ID", () => {
    const input = { version: 1, observations: [assessment().observations[0]], possibleCauses: [], unknowns: [] };
    expect(normalizeConditionAssessment(input, allowedPhotos)).toEqual(input);
    expect(normalizeConditionAssessment(assessment(), [])).toBeUndefined();
    expect(normalizeConditionAssessment({ ...input, observations: [{ ...input.observations[0], photoIds: ["photo-1"] }] }, allowedPhotos)).toBeUndefined();
  });

  it("copies only the contract and treats region labels as text, not geometry or confirmation", () => {
    const input = {
      ...assessment(), humanConfirmed: true, severity: "confirmed structural failure",
      observations: [{ ...assessment().observations[0], bounds: [0, 0, 1, 1], humanConfirmed: true }],
      possibleCauses: [],
    };
    const normalized = normalizeConditionAssessment(input, allowedPhotos);
    expect(normalized?.observations[0].regionLabel).toBe("lower edge");
    expect(normalized).not.toHaveProperty("humanConfirmed");
    expect(normalized).not.toHaveProperty("severity");
    expect(normalized?.observations[0]).not.toHaveProperty("bounds");
    expect(normalized?.observations[0]).not.toHaveProperty("humanConfirmed");
  });

  it.each([
    ["missing", undefined], ["null", null], ["array", []],
    ["missing version", { ...assessment(), version: undefined }],
    ["string version", { ...assessment(), version: "1" }],
    ["unknown version", { ...assessment(), version: 3 }],
    ["empty observations", { ...assessment(), observations: [] }],
    ["missing causes", { ...assessment(), possibleCauses: undefined }],
    ["missing unknowns", { ...assessment(), unknowns: undefined }],
    ["duplicate observation IDs", { ...assessment(), observations: [assessment().observations[0], assessment().observations[0]] }],
    ["missing photo reference", { ...assessment(), observations: [{ ...assessment().observations[0], photoIds: [] }] }],
    ["sparse photo reference", { ...assessment(), observations: [{ ...assessment().observations[0], photoIds: Array(1) }] }],
    ["invented photo reference", { ...assessment(), observations: [{ ...assessment().observations[0], photoIds: ["not-uploaded"] }] }],
    ["duplicate photo references", { ...assessment(), observations: [{ ...assessment().observations[0], photoIds: ["overview-1", "overview-1"] }] }],
    ["blank observation", { ...assessment(), observations: [{ ...assessment().observations[0], text: " " }] }],
    ["blank region", { ...assessment(), observations: [{ ...assessment().observations[0], regionLabel: " " }] }],
    ["geometry as region", { ...assessment(), observations: [{ ...assessment().observations[0], regionLabel: { x: 0.2 } }] }],
    ["cause without evidence", { ...assessment(), possibleCauses: [{ text: "Possible corrosion.", observationIds: [] }] }],
    ["invented observation reference", { ...assessment(), possibleCauses: [{ text: "Possible corrosion.", observationIds: ["missing"] }] }],
    ["duplicate observation references", { ...assessment(), possibleCauses: [{ text: "Possible corrosion.", observationIds: ["surface", "surface"] }] }],
    ["blank unknown", { ...assessment(), unknowns: [""] }],
    ["multiple next requests", { ...assessment(), nextEvidence: [assessment().nextEvidence, assessment().nextEvidence] }],
    ["null next request", { ...assessment(), nextEvidence: null }],
    ["unsupported next kind", { ...assessment(), nextEvidence: { ...assessment().nextEvidence, kind: "repair" } }],
    ["missing request purpose", { ...assessment(), nextEvidence: { ...assessment().nextEvidence, purpose: undefined } }],
    ["invented next photo reference", { ...assessment(), nextEvidence: { ...assessment().nextEvidence, photoIds: ["missing"] } }],
    ["empty next photo references", { ...assessment(), nextEvidence: { ...assessment().nextEvidence, photoIds: [] } }],
  ])("omits the entire assessment for %s", (_label, input) => {
    expect(normalizeConditionAssessment(input, allowedPhotos)).toBeUndefined();
  });

  it("rejects an invalid item instead of silently dropping it from a valid group", () => {
    const input = assessment();
    input.observations[1].photoIds = ["not-uploaded"];
    expect(normalizeConditionAssessment(input, allowedPhotos)).toBeUndefined();
  });

  it("enforces bounded counts and text without truncation", () => {
    const base = assessment();
    const overLimit = [
      { ...base, observations: Array.from({ length: 9 }, (_, i) => ({ ...base.observations[0], id: `obs-${i}` })) },
      { ...base, possibleCauses: Array(5).fill(base.possibleCauses[0]) },
      { ...base, unknowns: Array(9).fill("Unknown depth.") },
      { ...base, unknowns: ["x".repeat(601)] },
      { ...base, observations: [{ ...base.observations[0], id: "x".repeat(81) }] },
      { ...base, observations: [{ ...base.observations[0], text: "x".repeat(601) }] },
      { ...base, observations: [{ ...base.observations[0], regionLabel: "x".repeat(121) }] },
      { ...base, nextEvidence: { ...base.nextEvidence, request: "x".repeat(601) } },
    ];
    for (const input of overLimit) expect(normalizeConditionAssessment(input, allowedPhotos)).toBeUndefined();
    expect(normalizeConditionAssessment({ ...base, unknowns: ["x".repeat(600)] }, allowedPhotos)?.unknowns[0]).toHaveLength(600);
  });

  it.each(["photo", "marking", "measurement", "professional_inspection"])("accepts one %s request without optional photo references", (kind) => {
    const input = { ...assessment(), nextEvidence: { kind, request: "Record the next check.", purpose: "Resolve the remaining uncertainty." } };
    expect(normalizeConditionAssessment(input, allowedPhotos)?.nextEvidence).toEqual(input.nextEvidence);
  });

  it("preserves exact IDs rather than rewriting references by trimming", () => {
    const input = { version: 1, observations: [{ id: " obs ", text: "Flaking is visible.", photoIds: [" photo "] }], possibleCauses: [{ text: "Possible corrosion.", observationIds: [" obs "] }], unknowns: [] };
    expect(normalizeConditionAssessment(input, [" photo "])).toEqual(input);
    expect(normalizeConditionAssessment(input, ["photo"])).toBeUndefined();
  });

  it("retains distinct per-photo AI rectangles in v2 without inventing missing geometry", () => {
    const input = { ...assessment(), version: 2, observations: [
      { ...assessment().observations[0], areas: [
        { photoId: "overview-1", rectangle: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 } },
        { photoId: "close-up-2", rectangle: { x: 0.6, y: 0.1, width: 0.2, height: 0.2 } },
      ] }, assessment().observations[1],
    ] };
    const normalized = normalizeConditionAssessment(input, allowedPhotos);
    expect(normalized).toEqual(input);
    expect(normalized?.observations[0].areas?.[1].rectangle).not.toBe(input.observations[0].areas?.[1].rectangle);
    expect(normalized?.observations[1]).not.toHaveProperty("areas");
    expect(normalized).not.toHaveProperty("humanConfirmed");
    expect(normalizeConditionAssessment({ ...input, observations: [{ ...input.observations[0], areas: [] }, input.observations[1]] }, allowedPhotos)?.observations[0].areas).toEqual([]);
  });

  it.each([
    null, {}, Array(1),
    [{ photoId: "other-photo", rectangle: { x: 0, y: 0, width: 1, height: 1 } }],
    [{ photoId: "overview-1", rectangle: { x: 0, y: 0, width: 1, height: 1 } }],
    Array(2).fill({ photoId: "close-up-2", rectangle: { x: 0, y: 0, width: 1, height: 1 } }),
    [{ photoId: "close-up-2", rectangle: [0, 0, 1000, 1000] }],
    [{ photoId: "close-up-2", rectangle: { x: 200, y: 300, width: 100, height: 200 } }],
    [{ photoId: "close-up-2", rectangle: { x: 0, y: 0, width: "0.2", height: 0.2 } }],
    [{ photoId: "close-up-2", rectangle: { x: -0.01, y: 0, width: 0.2, height: 0.2 } }],
    [{ photoId: "close-up-2", rectangle: { x: 0.9, y: 0, width: 0.2, height: 0.2 } }],
    [{ photoId: "close-up-2", rectangle: { x: 0, y: 0.9, width: 0.2, height: 0.2 } }],
    [{ photoId: "close-up-2", rectangle: { x: 0, y: 0, width: 0, height: 0.2 } }],
    [{ photoId: "close-up-2", rectangle: { x: 0, y: NaN, width: 0.2, height: 0.2 } }],
    [{ photoId: "close-up-2", rectangle: { x: 0, y: 0, width: Infinity, height: 0.2 } }],
    [{ photoId: "close-up-2", rectangle: { x: 0, y: 0, width: 0.2, height: 0.2, confidence: 0.9 } }],
  ].map((areas) => [areas]))("rejects malformed or uncited v2 areas without rescaling, clipping or reassignment (%#)", (areas) => {
    const input = { ...assessment(), version: 2, observations: [{ ...assessment().observations[1], areas }], possibleCauses: [] };
    expect(normalizeConditionAssessment(input, allowedPhotos)).toBeUndefined();
  });

  it("does not silently upgrade a legacy assessment or accept future geometry in v1", () => {
    expect(normalizeConditionAssessment(assessment(), allowedPhotos)).toEqual(assessment());
    expect(normalizeConditionAssessment({ ...assessment(), observations: [{ ...assessment().observations[0], areas: [] }] }, allowedPhotos)).toBeUndefined();
  });
});
