import {
  extractGeneratedText,
  extractZeroShotLabelText,
  isOnDeviceFallbackEnabled,
  mapOnDeviceTextToResult,
  onOnDeviceModelProgress,
} from "./onDeviceIdentify";

describe("onDeviceIdentify", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("maps a well-formed model line into a low-confidence offline result", () => {
    const result = mapOnDeviceTextToResult("part: Brake caliper; category: brakes; note: surface rust visible");

    expect(result.partName).toBe("Brake caliper");
    expect(result.scanCategory).toBe("brakes");
    expect(result.confidence).toBe("low");
    expect(result.visibleObservations).toEqual(["surface rust visible"]);
    expect(result.safetyTriage).toBe("can_help");
    expect(result.isSafetyCritical).toBe(false);
    expect(result.modelRun?.provider).toBe("on-device");
    expect(result.modelRun?.fallbackReason).toBe("offline");
  });

  it("falls back to the first line and an unknown category for unstructured output", () => {
    const result = mapOnDeviceTextToResult("It looks like an alternator.");

    expect(result.partName).toBe("It looks like an alternator.");
    expect(result.scanCategory).toBe("unknown");
    expect(result.visibleObservations).toEqual([]);
  });

  it("detects a category mentioned anywhere in the text", () => {
    expect(mapOnDeviceTextToResult("This is part of the engine bay.").scanCategory).toBe("engine");
  });

  it("extracts the assistant reply from the transformers.js output shapes", () => {
    expect(
      extractGeneratedText([
        { generated_text: [{ role: "user", content: "x" }, { role: "assistant", content: "part: Hood" }] },
      ]),
    ).toBe("part: Hood");
    expect(extractGeneratedText([{ generated_text: "part: Hood" }])).toBe("part: Hood");
    expect(extractGeneratedText(null)).toBe("");
  });

  it("extracts the best zero-shot vehicle label into structured fallback text", () => {
    expect(extractZeroShotLabelText([{ label: "front fender", score: 0.83 }])).toBe(
      "part: front fender; category: body; note: on-device visual fallback, 83% label score",
    );
    expect(extractZeroShotLabelText(null)).toBe("");
  });

  it("registers and unregisters model-download progress listeners", () => {
    const unsubscribe = onOnDeviceModelProgress(() => {});
    expect(typeof unsubscribe).toBe("function");
    expect(() => unsubscribe()).not.toThrow();
    expect(() => unsubscribe()).not.toThrow();
  });

  it("reads the enable flag from the environment", () => {
    vi.stubEnv("VITE_ENABLE_ON_DEVICE_FALLBACK", "true");
    expect(isOnDeviceFallbackEnabled()).toBe(true);

    vi.stubEnv("VITE_ENABLE_ON_DEVICE_FALLBACK", "false");
    expect(isOnDeviceFallbackEnabled()).toBe(false);
  });

  it("retries model loading after a failed first attempt", async () => {
    vi.resetModules();
    const pipeline = vi.fn()
      .mockRejectedValueOnce(new Error("download failed"))
      .mockResolvedValueOnce(async () => [
        { label: "battery", score: 0.76 },
      ]);
    vi.doMock("@huggingface/transformers", () => ({ pipeline }));

    const { identifyOnDevice } = await import("./onDeviceIdentify");
    const frame = { imageBase64: "data:image/jpeg;base64,test", capturedAt: "2026-05-16T00:00:00.000Z" };

    await expect(identifyOnDevice(frame)).rejects.toThrow("download failed");
    await expect(identifyOnDevice(frame)).resolves.toMatchObject({
      partName: "battery",
      scanCategory: "electrical",
    });
    expect(pipeline).toHaveBeenCalledTimes(2);
    expect(pipeline).toHaveBeenCalledWith("zero-shot-image-classification", expect.any(String), expect.any(Object));

    vi.doUnmock("@huggingface/transformers");
    vi.resetModules();
  });
});
