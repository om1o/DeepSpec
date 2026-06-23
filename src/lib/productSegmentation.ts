import type { CapturedFrame } from "../types";

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

const DEFAULT_PRODUCT_SEGMENTATION_MODEL = "onnx-community/MVANet-ONNX";
const DEFAULT_SEGMENTATION_TIMEOUT_MS = 6500;
const pipelinesByModel = new Map<string, Promise<BackgroundRemovalPipeline>>();

export async function createSegmentedProductIsolationFrame(frame: CapturedFrame): Promise<CapturedFrame | null> {
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
  return imageBase64
    ? {
        capturedAt: new Date().toISOString(),
        imageBase64,
      }
    : null;
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
    && typeof FileReader !== "undefined"
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
