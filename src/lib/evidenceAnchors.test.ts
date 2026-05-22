import { getEvidenceRegionAnchor, inferEvidenceAnchor, isEvidenceAnchor } from "./evidenceAnchors";

describe("evidenceAnchors", () => {
  it("uses structured anchors before region-label inference", () => {
    expect(getEvidenceRegionAnchor({ anchor: "upper_right", regionLabel: "Lower left" })).toBe("upper_right");
  });

  it("infers stable anchors from common region labels", () => {
    expect(inferEvidenceAnchor("top left corner")).toBe("upper_left");
    expect(inferEvidenceAnchor("lower right of the scan")).toBe("lower_right");
    expect(inferEvidenceAnchor("middle of the photo")).toBe("center");
    expect(inferEvidenceAnchor("scanned area")).toBe("scanned_area");
  });

  it("rejects unsupported anchor strings", () => {
    expect(isEvidenceAnchor("upper_left")).toBe(true);
    expect(isEvidenceAnchor("top_left")).toBe(false);
  });
});
