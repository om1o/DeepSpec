let cachedSupport: Promise<boolean> | null = null;

/** Cached WebGPU availability check (one adapter request, reused everywhere). */
export function supportsWebGpu(): Promise<boolean> {
  if (cachedSupport) {
    return cachedSupport;
  }
  cachedSupport = (async () => {
    if (typeof navigator === "undefined") {
      return false;
    }
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
    if (!gpu) {
      return false;
    }
    try {
      return Boolean(await gpu.requestAdapter());
    } catch {
      return false;
    }
  })();
  return cachedSupport;
}
