export type ImageQualityIssue = "too_dark" | "too_bright" | "too_blurry";

export type ImageQualityResult =
  | { ok: true }
  | { ok: false; issue: ImageQualityIssue; message: string };

// Sample canvas dimensions — small enough to be instant, large enough for blur detection.
export const QUALITY_SAMPLE_W = 96;
export const QUALITY_SAMPLE_H = 72;

// Thresholds
const DARK_THRESHOLD = 20;    // avg luminance 0–255; below this = too dark to see detail
const BRIGHT_THRESHOLD = 235; // above this = overexposed / direct sunlight / reflective chrome
const BLUR_THRESHOLD = 120;   // gradient variance; below this = insufficient texture/sharpness

/**
 * Analyze pre-sampled luminance values for brightness and sharpness.
 * Pure function — no DOM. Pass the Uint8Array from sampleLuminance().
 */
export function analyzeQuality(
  lum: Uint8Array,
  width: number,
  height: number,
): ImageQualityResult {
  const pixels = width * height;

  // --- Brightness ---
  let sumLum = 0;
  for (let i = 0; i < pixels; i++) sumLum += lum[i];
  const avgLum = sumLum / pixels;

  if (avgLum < DARK_THRESHOLD) {
    return {
      ok: false,
      issue: "too_dark",
      message: "Too dark to scan. Add light or move to a brighter spot.",
    };
  }

  if (avgLum > BRIGHT_THRESHOLD) {
    return {
      ok: false,
      issue: "too_bright",
      message: "Too much glare or light. Shade the part or move out of direct sun.",
    };
  }

  // --- Sharpness (gradient variance) ---
  // For each interior pixel: |gx| + |gy|, then compute variance of those magnitudes.
  let sumGrad = 0;
  let sumGradSq = 0;
  const gradCount = (width - 2) * (height - 2);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const gx = lum[idx + 1] - lum[idx - 1];
      const gy = lum[idx + width] - lum[idx - width];
      const g = Math.abs(gx) + Math.abs(gy);
      sumGrad += g;
      sumGradSq += g * g;
    }
  }

  const meanGrad = sumGrad / gradCount;
  const varGrad = sumGradSq / gradCount - meanGrad * meanGrad;

  if (varGrad < BLUR_THRESHOLD) {
    return {
      ok: false,
      issue: "too_blurry",
      message: "Move closer and hold steady. Not enough detail to identify.",
    };
  }

  return { ok: true };
}

/**
 * Downsample a data URL onto a small canvas and extract BT.601 luminance values.
 * Returns null if the canvas API is unavailable or the image can't be decoded —
 * callers should pass through to AI in that case.
 */
export function sampleLuminance(dataUrl: string): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const img = new Image();

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = QUALITY_SAMPLE_W;
        canvas.height = QUALITY_SAMPLE_H;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(null); return; }

        ctx.drawImage(img, 0, 0, QUALITY_SAMPLE_W, QUALITY_SAMPLE_H);
        const { data } = ctx.getImageData(0, 0, QUALITY_SAMPLE_W, QUALITY_SAMPLE_H);
        const pixels = QUALITY_SAMPLE_W * QUALITY_SAMPLE_H;
        const lum = new Uint8Array(pixels);

        for (let i = 0; i < pixels; i++) {
          lum[i] = Math.round(
            0.299 * data[i * 4] +
            0.587 * data[i * 4 + 1] +
            0.114 * data[i * 4 + 2],
          );
        }

        resolve(lum);
      } catch {
        resolve(null);
      }
    };

    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/**
 * Full pre-flight check: sample the image and analyze quality.
 * Safe to call in any browser — returns ok:true if the check can't run.
 */
export async function assessImageQuality(dataUrl: string): Promise<ImageQualityResult> {
  const lum = await sampleLuminance(dataUrl);
  if (!lum) return { ok: true }; // can't check → let AI handle it
  return analyzeQuality(lum, QUALITY_SAMPLE_W, QUALITY_SAMPLE_H);
}
