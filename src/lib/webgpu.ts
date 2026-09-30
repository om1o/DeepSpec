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
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        gpu.requestAdapter().then(Boolean),
        new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), 500); }),
      ]);
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();
  return cachedSupport;
}
