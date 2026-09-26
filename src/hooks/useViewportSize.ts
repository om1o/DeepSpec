import { useMemo, useSyncExternalStore } from "react";

export type ViewportSize = { width: number; height: number };

function subscribe(onChange: () => void) {
  window.addEventListener("resize", onChange);
  window.addEventListener("orientationchange", onChange);
  return () => {
    window.removeEventListener("resize", onChange);
    window.removeEventListener("orientationchange", onChange);
  };
}

const getWidth = () => window.innerWidth;
const getHeight = () => window.innerHeight;

/**
 * The window's inner size, re-read on resize and rotation. Layout math that reads
 * `window.innerWidth` during render goes stale as soon as the device rotates, because nothing
 * else re-renders the component.
 */
export function useViewportSize(): ViewportSize {
  const width = useSyncExternalStore(subscribe, getWidth);
  const height = useSyncExternalStore(subscribe, getHeight);
  return useMemo(() => ({ width, height }), [width, height]);
}
