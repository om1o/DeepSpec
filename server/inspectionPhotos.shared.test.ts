import { buildPhotoEvidencePrompt, parseInspectionPhotos } from "./inspectionPhotos.shared";
import type { PhotoRelationship } from "../src/types";

const imageBase64 = "data:image/png;base64,aGVsbG8=";
const photos = [
  { id: "overview", label: "overview", imageBase64 },
  { id: "detail", label: "close_up", imageBase64 },
];

function parsedPhotos() {
  const parsed = parseInspectionPhotos({ photos });
  if ("error" in parsed) throw new Error("Invalid test fixture");
  return parsed.photos;
}

describe("explicit photo relationships", () => {
  it.each([
    { photos },
    { imageBase64, imageBase64_2: imageBase64 },
    { imageBase64 },
    {},
  ])("keeps an omitted relationship unknown for labeled, legacy and text inputs: %j", (body) => {
    expect(parseInspectionPhotos(body, false)).toMatchObject({ photoRelationship: "unknown" });
  });

  it.each([null, "", "same_part", "SAME_PART_OR_AREA", true, {}, []])("rejects an explicit invalid relationship even without photos: %j", (photoRelationship) => {
    for (const body of [{ photos, photoRelationship }, { photoRelationship }]) {
      expect(parseInspectionPhotos(body, false)).toMatchObject({ error: { status: 400, body: { error: { code: "invalid_input" } } } });
    }
  });

  it.each(["same_part_or_area", "independent", "unknown"] as const)("retains the exact valid relationship %s", (photoRelationship) => {
    expect(parseInspectionPhotos({ photos, photoRelationship })).toMatchObject({ photoRelationship });
  });

  it.each(["independent", "unknown"] as const)("scopes identity, vehicle facts and geometry to the first photo for %s", (relationship) => {
    const prompt = buildPhotoEvidencePrompt(parsedPhotos(), relationship);
    expect(prompt).toContain(relationship === "unknown" ? "Relationship unknown" : "Independent examples");
    expect(prompt).toContain("Use the first photo for the main identification and its geometry");
    expect(prompt).toContain("Supplied vehicle context applies only to the first photo");
    expect(prompt).toContain("Measurement context and supplemental OCR, when present, apply only to the first photo");
    expect(prompt).toContain("Consider every other photo separately");
    if (relationship === "independent") {
      expect(prompt).toContain("Return photoReview.disagreements as []");
      expect(prompt).toContain("report each photo's visible evidence and limits separately");
      expect(prompt).not.toContain("If views disagree");
      expect(prompt).not.toContain("name the conflicting photo ids");
    } else {
      expect(prompt).toContain("name the conflicting photo ids");
      expect(prompt).toContain("request one useful next view or marking");
    }
    expect(prompt).toContain("including a view that is unclear or does not support");
    expect(prompt).not.toContain("reported by the user");
  });

  it("treats a same-part choice as a report that can be contradicted, not proof", () => {
    const prompt = buildPhotoEvidencePrompt(parsedPhotos(), "same_part_or_area");
    expect(prompt).toContain("reported by the user, not independently verified");
    expect(prompt).toContain("treat that relationship as unverified");
    expect(prompt).toContain("Do not merge incompatible evidence");
    expect(prompt).toContain("name the conflicting photo ids");
    expect(prompt).toContain("Do not assume a before-and-after sequence");
    expect(prompt).toContain('"id":"overview"');
    expect(prompt).toContain('"id":"detail"');
  });

  it.each(["same_part_or_area", "independent", "unknown"] as PhotoRelationship[])("does not invent paired evidence with one photo (%s)", (relationship) => {
    const prompt = buildPhotoEvidencePrompt(parsedPhotos().slice(0, 1), relationship);
    expect(prompt).toContain("Only one photo is supplied");
    expect(prompt).not.toContain("Photo relationship:");
    expect(prompt).not.toContain("reported views");
    expect(prompt).not.toContain('"id":"detail"');
    expect(buildPhotoEvidencePrompt([], relationship)).toBe("");
  });
});
