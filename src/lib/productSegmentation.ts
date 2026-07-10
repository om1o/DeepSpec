import type { CapturedFrame, VisualFocusBox } from "../types";
import { CAPTURE_MAX_EDGE } from "./utils";
import { supportsWebGpu } from "./webgpu";

type BackgroundRemovalPipeline = ((image: string) => Promise<RawImageLike | RawImageLike[]>) & {
  dispose?: () => Promise<void> | void;
};

type RawImageLike = {
  toBlob: (type?: string, quality?: number) => Promise<Blob>;
};

type TransformersModule = {
  pipeline: (
    task: "background-removal",
    model: string,
    options?: {
      dtype?: "fp32" | "fp16" | "q8" | "q4";
      device?: string;
      progress_callback?: (progress: unknown) => void;
    },
  ) => Promise<BackgroundRemovalPipeline>;
};

type ProductSegmentationEnv = Partial<Record<"VITE_DEEPSPEC_SEGMENTATION" | "VITE_DEEPSPEC_SEGMENTATION_MODEL", string>>;

export type ProductIsolationResult = {
  focusBox: VisualFocusBox;
  frame: CapturedFrame;
  isolatedImageBase64: string;
};

const DEFAULT_PRODUCT_SEGMENTATION_MODEL = "onnx-community/MVANet-ONNX";
const DEFAULT_SEGMENTATION_DTYPE: "fp32" | "fp16" | "q8" | "q4" = "q8";
// Loading the model (first run downloads it) gets a long budget; warm it early so a real
// scan doesn't pay it. Inference + composite stay bounded so a slow phone falls back cleanly.
const SEGMENTATION_LOAD_TIMEOUT_MS = 20000;
const SEGMENTATION_INFERENCE_TIMEOUT_MS = 12000;
const SEGMENTATION_COMPOSITE_TIMEOUT_MS = 8000;
const pipelinesByModel = new Map<string, Promise<BackgroundRemovalPipeline>>();

export async function createSegmentedProductIsolation(frame: CapturedFrame): Promise<ProductIsolationResult | null> {
  if (!isProductSegmentationEnabled() || !canUseBrowserSegmentation()) {
    return null;
  }

  const model = getProductSegmentationModel();
  const pipeline = await withTimeout(getBackgroundRemovalPipeline(model), SEGMENTATION_LOAD_TIMEOUT_MS);
  if (!pipeline) {
    return null;
  }

  const isolated = await withTimeout(pipeline(frame.imageBase64), SEGMENTATION_INFERENCE_TIMEOUT_MS);
  if (!isolated) {
    return null;
  }

  const primaryImage = getPrimaryRawImage(isolated);
  if (!primaryImage) {
    return null;
  }

  const imageBase64 = await rawImageToDataUrl(primaryImage);
  if (!imageBase64) {
    return null;
  }

  const focusBox = await getAlphaFocusBox(imageBase64);
  if (!focusBox) {
    return null;
  }

  // The model output is low-res. Keep the model's alpha edges but paint them over the
  // native (~2K) crop so the isolated part stays sharp. Time-boxed; falls back to the model image.
  const sharpCutout = (await withTimeout(
    compositeAlphaOverSource(frame.imageBase64, imageBase64),
    SEGMENTATION_COMPOSITE_TIMEOUT_MS,
  )) ?? imageBase64;

  return {
    focusBox,
    frame: {
      capturedAt: new Date().toISOString(),
      imageBase64: sharpCutout,
    },
    isolatedImageBase64: sharpCutout,
  };
}

function compositeAlphaOverSource(sourceBase64: string, maskBase64: string): Promise<string | null> {
  return Promise.all([loadHtmlImage(sourceBase64), loadHtmlImage(maskBase64)])
    .then(([source, mask]) => {
      if (!source || !mask) {
        return null;
      }

      const sourceWidth = source.naturalWidth || source.width;
      const sourceHeight = source.naturalHeight || source.height;
      if (sourceWidth <= 0 || sourceHeight <= 0) {
        return null;
      }

      const scale = Math.min(1, CAPTURE_MAX_EDGE / Math.max(sourceWidth, sourceHeight));
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        return null;
      }

      context.drawImage(source, 0, 0, width, height);
      context.globalCompositeOperation = "destination-in";
      context.filter = "blur(1px)"; // feather the cutout edge so it isn't jagged
      context.drawImage(mask, 0, 0, width, height);
      context.filter = "none";
      return canvas.toDataURL("image/png");
    })
    .catch(() => null);
}

function loadHtmlImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

export function isProductSegmentationEnabled(env: ProductSegmentationEnv = import.meta.env as ProductSegmentationEnv) {
  const setting = env.VITE_DEEPSPEC_SEGMENTATION?.trim().toLowerCase();
  return setting !== "off" && setting !== "false" && setting !== "0";
}

export function getProductSegmentationModel(env: ProductSegmentationEnv = import.meta.env as ProductSegmentationEnv) {
  return env.VITE_DEEPSPEC_SEGMENTATION_MODEL?.trim() || DEFAULT_PRODUCT_SEGMENTATION_MODEL;
}

function getSegmentationDtype(): "fp32" | "fp16" | "q8" | "q4" {
  const raw = String((import.meta.env as Record<string, string | undefined>).VITE_DEEPSPEC_SEGMENTATION_DTYPE ?? "")
    .trim()
    .toLowerCase();
  if (raw === "fp32" || raw === "fp16" || raw === "q8" || raw === "q4") {
    return raw;
  }
  return DEFAULT_SEGMENTATION_DTYPE;
}

/** Start the model download/init early (e.g. when the scanner mounts) so the first scan is fast. */
export function warmProductSegmentation(): void {
  if (!isProductSegmentationEnabled() || !canUseBrowserSegmentation()) {
    return;
  }
  void Promise.resolve()
    .then(() => getBackgroundRemovalPipeline(getProductSegmentationModel()))
    .catch(() => {});
}

export function resetProductSegmentationForTests() {
  pipelinesByModel.clear();
}

function canUseBrowserSegmentation() {
  return typeof window !== "undefined"
    && typeof document !== "undefined"
    && typeof FileReader !== "undefined"
    && typeof Image !== "undefined"
    && typeof Blob !== "undefined";
}

function getBackgroundRemovalPipeline(model: string) {
  const existing = pipelinesByModel.get(model);
  if (existing) {
    return existing;
  }

  const pipelinePromise = import("@huggingface/transformers")
    .then(async (mod) => {
      const transformers = mod as TransformersModule;
      const dtype = getSegmentationDtype();
      const device = (await supportsWebGpu()) ? "webgpu" : "wasm";
      try {
        return await transformers.pipeline("background-removal", model, { dtype, device });
      } catch (error) {
        // WebGPU can reject for this model on some devices — fall back to WASM (the validated path).
        if (device === "webgpu") {
          return await transformers.pipeline("background-removal", model, { dtype, device: "wasm" });
        }
        throw error;
      }
    })
    .catch((error) => {
      pipelinesByModel.delete(model);
      throw error;
    });
  pipelinesByModel.set(model, pipelinePromise);
  return pipelinePromise;
}

function rawImageToDataUrl(image: RawImageLike) {
  return image.toBlob("image/png", 1).then(blobToDataUrl).catch(() => null);
}

function getAlphaFocusBox(imageBase64: string): Promise<VisualFocusBox | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      if (width <= 0 || height <= 0) {
        resolve(null);
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        resolve(null);
        return;
      }

      context.drawImage(image, 0, 0, width, height);
      const data = context.getImageData(0, 0, width, height).data;
      const bounds = getAlphaBounds(data, width, height);
      resolve(bounds);
    };
    image.onerror = () => resolve(null);
    image.src = imageBase64;
  });
}

function getAlphaBounds(data: Uint8ClampedArray, width: number, height: number): VisualFocusBox | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let count = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3] ?? 0;
      if (alpha < 24) {
        continue;
      }

      count += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  // Reject both extremes: too small (no real object) OR ~the whole frame (background NOT removed —
  // a degenerate "keep everything" matte). Letting the full-coverage case through set focusMode="mask"
  // and made the chip claim "Isolated" for what was visibly just the crop. Fall back to crop/"Focused".
  if (count < Math.max(24, width * height * 0.01) || count > width * height * 0.92 || maxX <= minX || maxY <= minY) {
    return null;
  }

  return {
    confidence: Math.min(1, Math.max(0.45, count / Math.max(1, width * height) * 2.2)),
    height: clamp01((maxY - minY + 1) / height),
    width: clamp01((maxX - minX + 1) / width),
    x: clamp01(minX / width),
    y: clamp01(minY / height),
  };
}

function getPrimaryRawImage(image: RawImageLike | RawImageLike[]) {
  return Array.isArray(image) ? image[0] ?? null : image;
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string | null>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T | null>((resolve) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      settled = true;
      resolve(null);
    }, timeoutMs);

    promise
      .then((value) => {
        if (!settled) {
          window.clearTimeout(timeoutId);
          settled = true;
          resolve(value);
        }
      })
      .catch(() => {
        if (!settled) {
          window.clearTimeout(timeoutId);
          settled = true;
          resolve(null);
        }
      });
  });
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
