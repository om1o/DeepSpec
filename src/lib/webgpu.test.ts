describe("WebGPU availability", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

  it("bounds a hung adapter request and ignores its late response", async () => {
    vi.resetModules(); vi.useFakeTimers();
    let finish!: (adapter: object) => void;
    const requestAdapter = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    vi.stubGlobal("navigator", { gpu: { requestAdapter } });
    const { supportsWebGpu } = await import("./webgpu");
    const result = supportsWebGpu();
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toBe(false);
    finish({});
    expect(await supportsWebGpu()).toBe(false);
    expect(requestAdapter).toHaveBeenCalledTimes(1);
  });

  it("preserves a working GPU adapter and shares the probe", async () => {
    vi.resetModules();
    const requestAdapter = vi.fn().mockResolvedValue({});
    vi.stubGlobal("navigator", { gpu: { requestAdapter } });
    const { supportsWebGpu } = await import("./webgpu");
    expect(await supportsWebGpu()).toBe(true);
    expect(await supportsWebGpu()).toBe(true);
    expect(requestAdapter).toHaveBeenCalledTimes(1);
  });
});
