let cachedSupport: Promise<boolean> | null = null;

/** Bound the initial wait, but retain a late adapter result for subsequent scans. */
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
        gpu.requestAdapter().then((adapter) => {
          const supported = Boolean(adapter);
          // A timeout means "not ready yet", not permanent lack of support.
          // Keep using this one probe; do not start more adapter requests on scans.
          cachedSupport = Promise.resolve(supported);
          return supported;
        }),
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
