import { createSegmentedProductIsolation, getProductSegmentationModel, isProductSegmentationEnabled, resetProductSegmentationForTests, warmProductSegmentation } from "./productSegmentation";

const { pipeline, supportsWebGpu } = vi.hoisted(() => ({ pipeline: vi.fn(), supportsWebGpu: vi.fn() }));
vi.mock("@huggingface/transformers", () => ({ pipeline }));
vi.mock("./webgpu", () => ({ supportsWebGpu }));

describe("productSegmentation", () => {
  beforeEach(() => {
    resetProductSegmentationForTests();
    pipeline.mockReset();
    supportsWebGpu.mockReset().mockResolvedValue(true);
  });

  it("skips model creation both on warmup and scan when WebGPU is unavailable", async () => {
    supportsWebGpu.mockResolvedValue(false);
    warmProductSegmentation();
    expect(await createSegmentedProductIsolation({ imageBase64: "data:image/png;base64,test", capturedAt: "2026-09-27" })).toBeNull();
    expect(pipeline).not.toHaveBeenCalled();
  });

  it.each(["available", "failed"])("uses only WebGPU when GPU setup is %s", async (state) => {
    if (state === "failed") pipeline.mockRejectedValue(new Error("Unsupported GPU"));
    else pipeline.mockResolvedValue(async () => null);
    expect(await createSegmentedProductIsolation({ imageBase64: "data:image/png;base64,test", capturedAt: "2026-09-27" })).toBeNull();
    expect(pipeline).toHaveBeenCalledTimes(1);
    expect(pipeline).toHaveBeenCalledWith("background-removal", "onnx-community/MVANet-ONNX", expect.objectContaining({ device: "webgpu" }));
  });
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
