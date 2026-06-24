import type { CapturedFrame, VisualFocusBox } from "../types";

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
const DEFAULT_SEGMENTATION_TIMEOUT_MS = 6500;
const pipelinesByModel = new Map<string, Promise<BackgroundRemovalPipeline>>();

export async function createSegmentedProductIsolation(frame: CapturedFrame): Promise<ProductIsolationResult | null> {
  if (!isProductSegmentationEnabled() || !canUseBrowserSegmentation()) {
    return null;
  }

  const model = getProductSegmentationModel();
  const pipeline = await withTimeout(getBackgroundRemovalPipeline(model), DEFAULT_SEGMENTATION_TIMEOUT_MS);
  if (!pipeline) {
    return null;
  }

  const isolated = await withTimeout(pipeline(frame.imageBase64), DEFAULT_SEGMENTATION_TIMEOUT_MS);
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

  return {
    focusBox,
    frame: {
      capturedAt: new Date().toISOString(),
      imageBase64,
    },
    isolatedImageBase64: imageBase64,
  };
}

export function isProductSegmentationEnabled(env: ProductSegmentationEnv = import.meta.env as ProductSegmentationEnv) {
  const setting = env.VITE_DEEPSPEC_SEGMENTATION?.trim().toLowerCase();
  return setting !== "off" && setting !== "false" && setting !== "0";
}

export function getProductSegmentationModel(env: ProductSegmentationEnv = import.meta.env as ProductSegmentationEnv) {
  return env.VITE_DEEPSPEC_SEGMENTATION_MODEL?.trim() || DEFAULT_PRODUCT_SEGMENTATION_MODEL;
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
    .then((transformers) => (transformers as TransformersModule).pipeline("background-removal", model, {
      dtype: "fp32",
    }))
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

  if (count < Math.max(24, width * height * 0.01) || maxX <= minX || maxY <= minY) {
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
