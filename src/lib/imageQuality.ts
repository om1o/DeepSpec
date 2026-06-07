export type ImageQualityIssue = "too_dark" | "lens_covered" | "too_bright" | "too_blurry";

export type ImageQualityMeasurements = {
  averageLuminance: number;
  brightPixelRatio: number;
  brightnessScore: number;
  darkPixelRatio: number;
  glareScore: number;
  gradientVariance: number;
  sampleHeight: number;
  sampleWidth: number;
  sharpnessScore: number;
};

export type ImageQualityResult =
  | { ok: true; metrics: ImageQualityMeasurements }
  | { ok: false; issue: ImageQualityIssue; message: string; metrics: ImageQualityMeasurements }
  | { ok: true; metrics?: undefined };

export const QUALITY_SAMPLE_W = 96;
export const QUALITY_SAMPLE_H = 72;

const DARK_THRESHOLD = 20;
const COVERED_LENS_VARIANCE = 8;
const BRIGHT_THRESHOLD = 235;
const BLUR_THRESHOLD = 120;

export function analyzeQuality(
  lum: Uint8Array,
  width: number,
  height: number,
): ImageQualityResult {
  const metrics = measureImageQuality(lum, width, height);

  if (metrics.averageLuminance < DARK_THRESHOLD) {
    if (metrics.gradientVariance < COVERED_LENS_VARIANCE) {
      return {
        metrics,
        ok: false,
        issue: "lens_covered",
        message: "Camera looks covered. Uncover the lens and try again.",
      };
    }

    return {
      metrics,
      ok: false,
      issue: "too_dark",
      message: "Too dark to scan. Add light or move to a brighter spot.",
    };
  }

  if (metrics.averageLuminance > BRIGHT_THRESHOLD) {
    return {
      metrics,
      ok: false,
      issue: "too_bright",
      message: "Too much glare or light. Shade the part or move out of direct sun.",
    };
  }

  if (metrics.gradientVariance < BLUR_THRESHOLD) {
    return {
      metrics,
      ok: false,
      issue: "too_blurry",
      message: "Move closer and hold steady. Not enough detail to identify.",
    };
  }

  return { ok: true, metrics };
}

export function sampleLuminance(dataUrl: string): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const img = new Image();

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = QUALITY_SAMPLE_W;
        canvas.height = QUALITY_SAMPLE_H;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }

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

export async function assessImageQuality(dataUrl: string): Promise<ImageQualityResult> {
  const lum = await sampleLuminance(dataUrl);
  if (!lum) return { ok: true };

  const result = analyzeQuality(lum, QUALITY_SAMPLE_W, QUALITY_SAMPLE_H);
  if (import.meta.env.DEV) {
    console.log("[deep-spec quality]", {
      avgLum: result.metrics?.averageLuminance,
      sharpnessScore: result.metrics?.sharpnessScore,
      verdict: result.ok ? "pass" : result.issue,
    });
  }

  return result;
}

function measureImageQuality(
  lum: Uint8Array,
  width: number,
  height: number,
): ImageQualityMeasurements {
  const pixels = width * height;
  let sumLum = 0;
  let darkPixels = 0;
  let brightPixels = 0;

  for (let i = 0; i < pixels; i++) {
    const value = lum[i];
    sumLum += value;
    if (value < DARK_THRESHOLD) darkPixels += 1;
    if (value > BRIGHT_THRESHOLD) brightPixels += 1;
  }

  const avgLum = sumLum / pixels;
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
  const brightPixelRatio = brightPixels / pixels;
  const darkPixelRatio = darkPixels / pixels;

  return {
    averageLuminance: roundMetric(avgLum),
    brightPixelRatio: roundRatio(brightPixelRatio),
    brightnessScore: clampScore(100 - (Math.abs(avgLum - 128) / 128) * 100),
    darkPixelRatio: roundRatio(darkPixelRatio),
    glareScore: clampScore(100 - brightPixelRatio * 500),
    gradientVariance: roundMetric(varGrad),
    sampleHeight: height,
    sampleWidth: width,
    sharpnessScore: clampScore((varGrad / BLUR_THRESHOLD) * 100),
  };
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function roundMetric(value: number) {
  return Math.round(value * 10) / 10;
}

function roundRatio(value: number) {
  return Math.round(value * 1000) / 1000;
}
