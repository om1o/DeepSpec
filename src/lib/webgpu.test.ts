describe("WebGPU availability", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); });

  it("bounds a slow adapter request but recovers when the adapter becomes available", async () => {
    vi.resetModules(); vi.useFakeTimers();
    let finish!: (adapter: object) => void;
    const requestAdapter = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    vi.stubGlobal("navigator", { gpu: { requestAdapter } });
    const { supportsWebGpu } = await import("./webgpu");
    const result = supportsWebGpu();
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toBe(false);
    finish({});
    await vi.advanceTimersByTimeAsync(0);
    expect(await supportsWebGpu()).toBe(true);
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

  it("keeps a hung probe bounded for repeated callers without starting more requests", async () => {
    vi.resetModules(); vi.useFakeTimers();
    const requestAdapter = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("navigator", { gpu: { requestAdapter } });
    const { supportsWebGpu } = await import("./webgpu");
    const first = supportsWebGpu();
    const second = supportsWebGpu();
    await vi.advanceTimersByTimeAsync(500);
    expect(await first).toBe(false);
    expect(await second).toBe(false);
    expect(await supportsWebGpu()).toBe(false);
    expect(requestAdapter).toHaveBeenCalledTimes(1);
  });

  it("handles an adapter rejection after the initial wait expires", async () => {
    vi.resetModules(); vi.useFakeTimers();
    let reject!: (reason: Error) => void;
    const requestAdapter = vi.fn(() => new Promise((_, fail) => { reject = fail; }));
    vi.stubGlobal("navigator", { gpu: { requestAdapter } });
    const { supportsWebGpu } = await import("./webgpu");
    const initial = supportsWebGpu();
    await vi.advanceTimersByTimeAsync(500);
    expect(await initial).toBe(false);
    reject(new Error("Adapter unavailable"));
    await vi.advanceTimersByTimeAsync(0);
    expect(await supportsWebGpu()).toBe(false);
    expect(requestAdapter).toHaveBeenCalledTimes(1);
  });
});
