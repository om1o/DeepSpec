import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSceneCropFallbacks, getBoxPromptPoints, getPromptableSegmentationModel, isPromptableSegmentationEnabled, isolateSceneObjects, pickBestFitMask, resetPromptableSegmentationForTests, type SceneObjectInput } from "./promptableSegmentation";

const { loadModel, loadProcessor, readImage, supportsWebGpu } = vi.hoisted(() => ({
  loadModel: vi.fn(), loadProcessor: vi.fn(), readImage: vi.fn(), supportsWebGpu: vi.fn(),
}));
vi.mock("@huggingface/transformers", () => ({
  SamModel: { from_pretrained: loadModel }, AutoProcessor: { from_pretrained: loadProcessor }, RawImage: { read: readImage },
}));
vi.mock("./browserTransformers", () => ({ configureSameOriginOnnxRuntime: vi.fn() }));
vi.mock("./webgpu", () => ({ supportsWebGpu }));

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

describe("getBoxPromptPoints", () => {
  it("spreads five points across the inner half of the box, center first", () => {
    const points = getBoxPromptPoints({ x: 0.2, y: 0.4, width: 0.4, height: 0.2, confidence: 1 });
    const rounded = points.map(([x, y]) => [Number(x.toFixed(3)), Number(y.toFixed(3))]);
    expect(rounded).toEqual([
      [0.4, 0.5],
      [0.3, 0.5],
      [0.5, 0.5],
      [0.4, 0.45],
      [0.4, 0.55],
    ]);
  });

  it("keeps every point inside the frame", () => {
    const points = getBoxPromptPoints({ x: 0.9, y: -0.1, width: 0.4, height: 0.3, confidence: 1 });
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
  });
});

describe("pickBestFitMask", () => {
  const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

  it("prefers the mask that fills the target box over a higher-scored sub-part", () => {
    // Label-at-center case: SAM scored the label highest, but the whole product fits the box.
    const target = { ...box(0.35, 0.3, 0.3, 0.4), confidence: 1 };
    const picked = pickBestFitMask(
      [
        { box: box(0.441, 0.46, 0.138, 0.08), samScore: 0.97 },
        { box: box(0.35, 0.3, 0.3, 0.399), samScore: 0.9 },
        { box: box(0.1, 0.1, 0.8, 0.8), samScore: 0.8 },
      ],
      target,
    );
    expect(picked).toBe(1);
  });

  it("prefers the mask that fits the target box over a higher-scored oversized one", () => {
    // Rotated engine-cover case: SAM scored "cover + manifold" highest.
    const target = { ...box(0.48, 0.18, 0.37, 0.65), confidence: 1 };
    const picked = pickBestFitMask(
      [
        { box: box(0.6, 0.4, 0.1, 0.1), samScore: 0.7 },
        { box: box(0.474, 0.194, 0.373, 0.635), samScore: 0.88 },
        { box: box(0.193, 0.184, 0.654, 0.816), samScore: 0.95 },
      ],
      target,
    );
    expect(picked).toBe(1);
  });

  it("lets SAM's score break a near-tie in fit", () => {
    const target = { ...box(0.2, 0.2, 0.4, 0.4), confidence: 1 };
    const picked = pickBestFitMask(
      [
        { box: box(0.2, 0.2, 0.4, 0.4), samScore: 0.5 },
        { box: box(0.2, 0.2, 0.4, 0.396), samScore: 0.95 },
      ],
      target,
    );
    expect(picked).toBe(1);
  });

  it("skips empty masks and returns -1 when all are empty", () => {
    const target = { ...box(0.2, 0.2, 0.4, 0.4), confidence: 1 };
    expect(pickBestFitMask([{ box: null, samScore: 0.99 }, { box: box(0.9, 0.9, 0.05, 0.05), samScore: 0.1 }], target)).toBe(1);
    expect(pickBestFitMask([{ box: null, samScore: 0.99 }], target)).toBe(-1);
  });
});

describe("scene selection preservation", () => {
  const frame = { imageBase64: "data:image/png;base64,b3JpZ2luYWw=", capturedAt: "2026-11-05T12:00:00.000Z" };
  const inputs: SceneObjectInput[] = [
    { name: "Alternator", category: "engine", primary: true, box: { x: 0.05, y: 0.05, width: 0.4, height: 0.4, confidence: 0.8 } },
    { name: "Bracket", category: "engine", primary: false, box: { x: 0.55, y: 0.55, width: 0.4, height: 0.4, confidence: 0.6 } },
  ];
  const model = vi.fn();
  const postProcess = vi.fn();

  // Two 20x20 mask planes, each with an 8x8 selected region. Canvas/Image are
  // mocked at the browser boundary; the real mask selection/composition control flow runs.
  const maskTensor = (nonempty: number[], count = 2) => {
    const data = new Uint8Array(count * 20 * 20);
    for (const index of nonempty) {
      const start = index === 0 ? 1 : 11;
      for (let y = start; y < start + 8; y += 1) {
        for (let x = start; x < start + 8; x += 1) data[index * 400 + y * 20 + x] = 1;
      }
    }
    return { data, dims: [count, 1, 20, 20] };
  };
  const expectedCrops = (selected = inputs) => selected.map((input) => ({
    name: input.name, category: input.category, primary: input.primary,
    focusBox: input.box, isolatedImageBase64: "", focusMode: "crop",
  }));

  beforeEach(() => {
    resetPromptableSegmentationForTests();
    vi.stubEnv("VITE_DEEPSPEC_PROMPTABLE_SEG", "true");
    supportsWebGpu.mockReset().mockResolvedValue(true);
    readImage.mockReset().mockResolvedValue({});
    model.mockReset().mockResolvedValue({ pred_masks: maskTensor([0, 1]), iou_scores: { data: [0.9, 0.8], dims: [2, 1] } });
    postProcess.mockReset().mockResolvedValue([maskTensor([0, 1])]);
    const processor = Object.assign(vi.fn().mockResolvedValue({ original_sizes: [[20, 20]], reshaped_input_sizes: [[20, 20]] }), {
      post_process_masks: postProcess,
    });
    loadModel.mockReset().mockResolvedValue(model);
    loadProcessor.mockReset().mockResolvedValue(processor);
    vi.stubGlobal("Image", class {
      width = 20;
      height = 20;
      naturalWidth = 20;
      naturalHeight = 20;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(20 * 20 * 4) }),
      putImageData: vi.fn(), filter: "none",
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,bWFzaw==");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetPromptableSegmentationForTests();
  });

  it("shares a bounded, independent crop snapshot without inventing invalid geometry", () => {
    const valid = Array.from({ length: 5 }, (_, index) => ({ ...inputs[0], name: `Part ${index}`, box: { ...inputs[0].box } }));
    const selected = [{ ...inputs[1], box: { ...inputs[1].box, width: 0 } }, ...valid];
    const crops = createSceneCropFallbacks(selected);
    expect(crops).toEqual(expectedCrops(valid.slice(0, 4)));
    valid[0].box.x = 0.8;
    expect(crops[0].focusBox.x).toBe(0.05);
    expect(createSceneCropFallbacks([{ ...inputs[0], box: { ...inputs[0].box, x: NaN } }])).toEqual([]);
  });

  it.each(["disabled", "no browser", "no WebGPU", "WebGPU rejection"])("retains both selections as crops with %s", async (reason) => {
    if (reason === "disabled") vi.stubEnv("VITE_DEEPSPEC_PROMPTABLE_SEG", "false");
    if (reason === "no browser") vi.stubGlobal("Image", undefined);
    if (reason === "no WebGPU") supportsWebGpu.mockResolvedValue(false);
    if (reason === "WebGPU rejection") supportsWebGpu.mockRejectedValue(new Error("Adapter unavailable"));
    expect(await isolateSceneObjects(frame, inputs)).toEqual(expectedCrops());
    expect(loadModel).not.toHaveBeenCalled();
  });

  it("does not load a model for no valid selections", async () => {
    expect(await isolateSceneObjects(frame, [])).toEqual([]);
    expect(await isolateSceneObjects(frame, [{ ...inputs[0], box: { ...inputs[0].box, height: 0 } }])).toEqual([]);
    expect(loadModel).not.toHaveBeenCalled();
  });

  it("retains original boxes when pipeline creation fails", async () => {
    loadModel.mockRejectedValue(new Error("GPU pipeline failed"));
    expect(await isolateSceneObjects(frame, inputs)).toEqual(expectedCrops());
    expect(model).not.toHaveBeenCalled();
  });

  it("retains original boxes when model loading times out", async () => {
    vi.useFakeTimers();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    loadModel.mockImplementation(() => { markStarted(); return new Promise(() => {}); });
    const pending = isolateSceneObjects(frame, inputs);
    await started;
    expect(loadModel).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await pending).toEqual(expectedCrops());
    expect(model).not.toHaveBeenCalled();
  });

  it("retains original boxes when inference throws", async () => {
    model.mockRejectedValue(new Error("GPU inference failed"));
    expect(await isolateSceneObjects(frame, inputs)).toEqual(expectedCrops());
    expect(model).toHaveBeenCalledTimes(1);
  });

  it("retains original boxes when inference times out", async () => {
    vi.useFakeTimers();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    model.mockImplementation(() => { markStarted(); return new Promise(() => {}); });
    const pending = isolateSceneObjects(frame, inputs);
    await started;
    expect(model).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await pending).toEqual(expectedCrops());
  });

  it("retains every selection when all masks are empty", async () => {
    postProcess.mockResolvedValue([maskTensor([])]);
    expect(await isolateSceneObjects(frame, inputs)).toEqual(expectedCrops());
    expect(model).toHaveBeenCalledTimes(1);
  });

  it.each(["empty", "missing", "composite failure"])("retains a successful first mask and the second original selection after %s", async (reason) => {
    if (reason === "empty") postProcess.mockResolvedValue([maskTensor([0])]);
    if (reason === "missing") postProcess.mockResolvedValue([maskTensor([0], 1)]);
    if (reason === "composite failure") {
      vi.mocked(HTMLCanvasElement.prototype.toDataURL)
        .mockReturnValueOnce("data:image/png;base64,bWFzaw==")
        .mockImplementationOnce(() => { throw new Error("Canvas export failed"); });
    }
    const result = await isolateSceneObjects(frame, inputs);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ name: "Alternator", primary: true, focusMode: "mask", isolatedImageBase64: "data:image/png;base64,bWFzaw==" });
    expect(result[0].focusBox).toEqual({ x: 0, y: 0, width: 0.5, height: 0.5, confidence: 0.5 });
    expect(result[1]).toEqual(expectedCrops()[1]);
  });

  it("keeps successful masks explicit and aligned with both input selections", async () => {
    const result = await isolateSceneObjects(frame, inputs);
    expect(result.map(({ name, primary, focusMode, isolatedImageBase64 }) => ({ name, primary, focusMode, isolatedImageBase64 }))).toEqual([
      { name: "Alternator", primary: true, focusMode: "mask", isolatedImageBase64: "data:image/png;base64,bWFzaw==" },
      { name: "Bracket", primary: false, focusMode: "mask", isolatedImageBase64: "data:image/png;base64,bWFzaw==" },
    ]);
    expect(result.map((entry) => entry.focusBox)).toEqual([
      { x: 0, y: 0, width: 0.5, height: 0.5, confidence: 0.5 },
      { x: 0.5, y: 0.5, width: 0.5, height: 0.5, confidence: 0.5 },
    ]);
    expect(model).toHaveBeenCalledTimes(1);
  });
});
