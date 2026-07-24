import { describe, expect, it } from "vitest";
import { getPromptableSegmentationModel, isPromptableSegmentationEnabled } from "./promptableSegmentation";

describe("promptableSegmentation gating", () => {
  it("is enabled by default with the SlimSAM model", () => {
    expect(isPromptableSegmentationEnabled({})).toBe(true);
    expect(getPromptableSegmentationModel({})).toBe("Xenova/slimsam-77-uniform");
  });

  it.each(["off", "false", "0"])("can be turned off with %s", (value) => {
    expect(isPromptableSegmentationEnabled({ VITE_DEEPSPEC_PROMPTABLE_SEG: value })).toBe(false);
  });

  it("honors a model override", () => {
    expect(
      getPromptableSegmentationModel({ VITE_DEEPSPEC_PROMPTABLE_SEG_MODEL: "Xenova/sam-vit-base" }),
    ).toBe("Xenova/sam-vit-base");
  });
});
