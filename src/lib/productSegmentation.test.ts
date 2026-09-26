import { getProductSegmentationModel, isProductSegmentationEnabled } from "./productSegmentation";

describe("productSegmentation", () => {
  it("keeps product isolation enabled by default", () => {
    expect(isProductSegmentationEnabled({})).toBe(true);
    expect(getProductSegmentationModel({})).toBe("onnx-community/MVANet-ONNX");
  });

  it.each(["off", "false", "0"])("lets preview builds disable product isolation with %s", (value) => {
    expect(isProductSegmentationEnabled({ VITE_DEEPSPEC_SEGMENTATION: value })).toBe(false);
  });

  it("uses the configured segmentation model when supplied", () => {
    expect(getProductSegmentationModel({
      VITE_DEEPSPEC_SEGMENTATION_MODEL: "custom/product-mask",
    })).toBe("custom/product-mask");
  });
});
