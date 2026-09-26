import type { CapturedFrame, IsolatedObject, VisualFocusBox } from "../types";
import type { ProductIsolationResult } from "./productSegmentation";
import { supportsWebGpu } from "./webgpu";
import { recordScanDebug } from "./scanDebug";

// Bump on every change to this module. Logged once at module load so the console confirms the
// browser is actually running the latest build — not a stale Vite/HMR bundle or a cached
// service-worker asset. If you don't see this exact version after a reload, the code is stale.
const PROMPTABLE_SEG_VERSION = "7 (five-point prompts + best-fit mask selection)";
try {
  console.info(`[DeepSpec SAM] promptableSegmentation v${PROMPTABLE_SEG_VERSION} loaded`);
} catch {
  // ignore logging failures
}

// ── Promptable (prompted) isolation ─────────────────────────────────────────
// MVANet mattes the WHOLE foreground (it keeps the hand holding an object). A promptable
// segmenter (SlimSAM) takes a prompt per object and returns just that object. We seed five
// positive points spread across each detector box — SlimSAM's exported ONNX decoder only accepts
// point prompts, not input_boxes. SAM embeds the image once, then decodes each prompt cheaply,
// so multiple objects are one inference. Fully gated; returns null/[] on any failure so the
// pipeline can never get worse.

type SamTensor = { data: ArrayLike<number>; dims: number[] };
type SamModelLike = (inputs: Record<string, unknown>) => Promise<{ pred_masks: SamTensor; iou_scores: SamTensor }>;
type SamProcessed = { original_sizes: number[][]; reshaped_input_sizes: number[][] } & Record<string, unknown>;
type SamProcessorLike = ((image: unknown, options: { input_points: number[][][] }) => Promise<SamProcessed>) & {
  post_process_masks: (
    predMasks: SamTensor,
    originalSizes: number[][],
    reshapedInputSizes: number[][],
  ) => Promise<SamTensor[]>;
};
type SamTransformersModule = {
  SamModel: { from_pretrained: (model: string, opts?: { dtype?: string; device?: string }) => Promise<SamModelLike> };
  AutoProcessor: { from_pretrained: (model: string) => Promise<SamProcessorLike> };
  RawImage: { read: (url: string) => Promise<unknown>; fromURL?: unknown; fromBlob?: unknown };
  env?: { version?: string };
};

type PromptableEnv = Partial<Record<
  "VITE_DEEPSPEC_PROMPTABLE_SEG" | "VITE_DEEPSPEC_PROMPTABLE_SEG_MODEL" | "VITE_DEEPSPEC_PROMPTABLE_SEG_DTYPE",
  string
>>;

const DEFAULT_PROMPTABLE_MODEL = "Xenova/slimsam-77-uniform";
const DEFAULT_PROMPTABLE_DTYPE = "q8";
const PROMPTABLE_LOAD_TIMEOUT_MS = 25000;
const PROMPTABLE_INFERENCE_TIMEOUT_MS = 25000;
const PROMPTABLE_MULTI_TIMEOUT_MS = 25000;
const PROMPTABLE_COMPOSITE_TIMEOUT_MS = 8000;
const MAX_SCENE_OBJECTS = 4;

type SamPipeline = { model: SamModelLike; processor: SamProcessorLike; read: (url: string) => Promise<unknown> };
type CutoutResult = { focusBox: VisualFocusBox; imageBase64: string };
type SelectedMask = { data: ArrayLike<number>; width: number; height: number; offset: number };

export type SceneObjectInput = { name: string; category: string; box: VisualFocusBox; primary: boolean };

const pipelinesByModel = new Map<string, Promise<SamPipeline>>();

export function isPromptableSegmentationEnabled(env: PromptableEnv = import.meta.env as PromptableEnv) {
  const setting = env.VITE_DEEPSPEC_PROMPTABLE_SEG?.trim().toLowerCase();
  return setting !== "off" && setting !== "false" && setting !== "0";
}

export function getPromptableSegmentationModel(env: PromptableEnv = import.meta.env as PromptableEnv) {
  return env.VITE_DEEPSPEC_PROMPTABLE_SEG_MODEL?.trim() || DEFAULT_PROMPTABLE_MODEL;
}

function getPromptableDtype(env: PromptableEnv = import.meta.env as PromptableEnv) {
  const raw = env.VITE_DEEPSPEC_PROMPTABLE_SEG_DTYPE?.trim().toLowerCase();
  return raw === "fp32" || raw === "fp16" || raw === "q8" || raw === "q4" ? raw : DEFAULT_PROMPTABLE_DTYPE;
}

/** Start the SAM model download/init early (e.g. on scanner mount) so the first scan is fast. */
export function warmPromptableSegmentation(): void {
  if (!isPromptableSegmentationEnabled() || !canUseBrowserSegmentation()) {
    return;
  }
  void supportsWebGpu().then((webgpu) => {
    samLog({ stage: "webgpu", supported: webgpu });
    if (webgpu) {
      void Promise.resolve().then(() => getSamPipeline(getPromptableSegmentationModel())).catch(() => {});
    }
  });
}

export function resetPromptableSegmentationForTests() {
  pipelinesByModel.clear();
}

/** Single-object isolation: segment just the object inside `targetBox` (full-frame normalized). */
export async function createPromptedProductIsolation(
  frame: CapturedFrame,
  targetBox: VisualFocusBox,
): Promise<ProductIsolationResult | null> {
  if (!isPromptableSegmentationEnabled()) {
    samLog({ stage: "skip", reason: "disabled-env" });
    return null;
  }
  if (!canUseBrowserSegmentation()) {
    samLog({ stage: "skip", reason: "no-browser-apis" });
    return null;
  }
  if (!(await supportsWebGpu())) {
    samLog({ stage: "skip", reason: "no_webgpu" });
    return null; // SAM is WebGPU-only here; WASM is too slow on phones → fall back to MVANet.
  }

  const loadStart = clock();
  const pipeline = await withTimeout(getSamPipeline(getPromptableSegmentationModel()), PROMPTABLE_LOAD_TIMEOUT_MS);
  samLog({ stage: "load", ms: Math.round(clock() - loadStart), ok: Boolean(pipeline) });
  if (!pipeline) {
    return null;
  }

  const inferStart = clock();
  const cutouts = await withTimeout(
    isolateBoxes(pipeline, frame.imageBase64, [targetBox]),
    PROMPTABLE_INFERENCE_TIMEOUT_MS,
    () => samLog({ stage: "inference-timeout", ms: PROMPTABLE_INFERENCE_TIMEOUT_MS }),
    (error) => samLog({ stage: "inference-error", message: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }),
  );
  samLog({ stage: "inference", boxes: 1, ms: Math.round(clock() - inferStart), ok: Boolean(cutouts?.[0]) });
  const cutout = cutouts?.[0];
  if (!cutout) {
    return null;
  }

  return {
    focusBox: cutout.focusBox,
    frame: { capturedAt: new Date().toISOString(), imageBase64: cutout.imageBase64 },
    isolatedImageBase64: cutout.imageBase64,
  };
}

/** Multi-object isolation: segment up to 4 scene objects in one inference pass. */
export async function isolateSceneObjects(frame: CapturedFrame, inputs: SceneObjectInput[]): Promise<IsolatedObject[]> {
  if (!isPromptableSegmentationEnabled() || !canUseBrowserSegmentation() || inputs.length === 0) {
    return [];
  }
  if (!(await supportsWebGpu())) {
    return [];
  }

  const capped = inputs.slice(0, MAX_SCENE_OBJECTS);
  const pipeline = await withTimeout(getSamPipeline(getPromptableSegmentationModel()), PROMPTABLE_LOAD_TIMEOUT_MS);
  if (!pipeline) {
    return [];
  }

  const inferStart = clock();
  const cutouts = await withTimeout(
    isolateBoxes(pipeline, frame.imageBase64, capped.map((input) => input.box)),
    PROMPTABLE_MULTI_TIMEOUT_MS,
    () => samLog({ stage: "inference-timeout", ms: PROMPTABLE_MULTI_TIMEOUT_MS }),
    (error) => samLog({ stage: "inference-error", message: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }),
  );
  samLog({ stage: "inference-multi", boxes: capped.length, ms: Math.round(clock() - inferStart), ok: Boolean(cutouts) });
  if (!cutouts) {
    return [];
  }

  const objects: IsolatedObject[] = [];
  capped.forEach((input, index) => {
    const cutout = cutouts[index];
    if (cutout) {
      objects.push({
        name: input.name,
        category: input.category,
        primary: input.primary,
        focusBox: cutout.focusBox,
        isolatedImageBase64: cutout.imageBase64,
      });
    }
  });
  return objects;
}

async function isolateBoxes(
  pipeline: SamPipeline,
  frameBase64: string,
  boxes: VisualFocusBox[],
): Promise<(CutoutResult | null)[] | null> {
  try {
    const [rawImage, frameImage] = await Promise.all([pipeline.read(frameBase64), loadHtmlImage(frameBase64)]);
    if (!frameImage) {
      samLog({ stage: "inference-empty", reason: "frame image failed to load" });
      return null;
    }

    const frameWidth = frameImage.naturalWidth || frameImage.width;
    const frameHeight = frameImage.naturalHeight || frameImage.height;
    if (frameWidth <= 0 || frameHeight <= 0) {
      samLog({ stage: "inference-empty", reason: "frame has no size" });
      return null;
    }

    // SlimSAM's exported ONNX decoder only accepts point prompts (input_boxes isn't a graph input),
    // and SamModel.forward dereferences input_points on box-only input → the "reading 'dims'" crash.
    // So seed several positive points spread across each box (see getBoxPromptPoints); labels
    // default to 1 (positive) in the forward, and there is still one prompt per box, so the output
    // shape — and selectMask — are unchanged.
    const pointPrompts = boxes.map((box) =>
      getBoxPromptPoints(box).map(([x, y]) => [x * frameWidth, y * frameHeight]),
    );
    const inputs = await pipeline.processor(rawImage, { input_points: pointPrompts });

    // Point prompts above are computed in frameImage's pixel space (frameWidth/frameHeight), but
    // the processor reshapes them against ITS OWN decode of the same source (original_sizes). If
    // the two decodes disagree (e.g. a rotated/EXIF-oriented source), the point lands on the wrong
    // spot in what the model actually sees, and SAM segments an unrelated region.
    const modelSize = inputs.original_sizes?.[0];
    samLog({
      stage: "prompt-geometry",
      frameDims: `${frameWidth}x${frameHeight}`,
      modelDims: modelSize ? `${modelSize[1]}x${modelSize[0]}` : "unknown",
      pointsPx: pointPrompts.map((points) => points.map((point) => point.map((v) => Math.round(v)))),
    });

    const modelStart = clock();
    const outputs = await pipeline.model(inputs);
    const modelMs = Math.round(clock() - modelStart);
    const postStart = clock();
    const masks = await pipeline.processor.post_process_masks(
      outputs.pred_masks,
      inputs.original_sizes,
      inputs.reshaped_input_sizes,
    );
    // One-time probe: raw output shapes + per-stage timing, so shape drift or a slow vision
    // encoder is visible in diagnostics instead of guessed at.
    samLog({
      stage: "raw-output",
      points: pointPrompts.length,
      modelMs,
      postMs: Math.round(clock() - postStart),
      predMasks: tensorDims(outputs?.pred_masks),
      iouScores: tensorDims(outputs?.iou_scores),
      maskCount: Array.isArray(masks) ? masks.length : null,
      maskDims: tensorDims(masks?.[0]),
    });
    const maskTensor = masks[0];

    const results: (CutoutResult | null)[] = [];
    for (let boxIndex = 0; boxIndex < boxes.length; boxIndex += 1) {
      const selected = selectMask(maskTensor, outputs.iou_scores, boxIndex, boxes.length, boxes[boxIndex]);
      if (!selected) {
        samLog({ stage: "inference-empty", reason: `no mask tensor (dims ${maskTensor?.dims?.join("x") ?? "?"})` });
        results.push(null);
        continue;
      }
      const cutout = await withTimeout(
        compositeMaskedCutout(frameImage, selected, boxes[boxIndex]),
        PROMPTABLE_COMPOSITE_TIMEOUT_MS,
      );
      if (!cutout) {
        samLog({ stage: "inference-empty", reason: "mask too small / composite failed" });
      }
      results.push(cutout);
    }
    return results;
  } catch (error) {
    // This is where SAM was failing silently — surface the real reason.
    samLog({ stage: "inference-error", message: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
    return null;
  }
}

/**
 * Positive prompt points for one target box, full-frame normalized: the center plus four points
 * halfway between the center and each edge. A lone center point made SAM return whatever small
 * part sat under it (a label, a connector) instead of the whole object; the extra points tell it
 * the object spans the box. They stay on the inner half so a loosely drawn box doesn't put a
 * positive point on the background.
 */
export function getBoxPromptPoints(box: VisualFocusBox): [number, number][] {
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const offsetX = box.width / 4;
  const offsetY = box.height / 4;
  return [
    [centerX, centerY],
    [centerX - offsetX, centerY],
    [centerX + offsetX, centerY],
    [centerX, centerY - offsetY],
    [centerX, centerY + offsetY],
  ].map(([x, y]) => [clamp01(x), clamp01(y)]);
}

export type MaskCandidate = {
  /** Mask bbox, full-frame normalized; null when the mask is empty. */
  box: { x: number; y: number; width: number; height: number } | null;
  /** SAM's own predicted-IoU score for this mask. */
  samScore: number;
};

// SAM's score only breaks near-ties between masks that fit the target box about equally well.
const SAM_SCORE_TIEBREAK_WEIGHT = 0.1;

/**
 * Pick which of SAM's candidate masks (one prompt yields 3: sub-part / part / whole) to keep, by
 * how well each mask's bbox matches the target box (box IoU) rather than by SAM's own score.
 * SAM's score alone picked a label under a single center point (too small) and, with five
 * points, the whole engine around an engine cover (too big); the target box knows the intended
 * size and shape. Returns -1 when every candidate is empty.
 */
export function pickBestFitMask(candidates: MaskCandidate[], target: VisualFocusBox): number {
  let best = -1;
  let bestScore = -Infinity;
  candidates.forEach((candidate, index) => {
    if (!candidate.box) {
      return;
    }
    const score = getBoxIou(candidate.box, target) + SAM_SCORE_TIEBREAK_WEIGHT * (Number.isFinite(candidate.samScore) ? candidate.samScore : 0);
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });
  return best;
}

function getBoxIou(a: NonNullable<MaskCandidate["box"]>, b: VisualFocusBox): number {
  const intersectionWidth = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const intersectionHeight = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const intersection = intersectionWidth * intersectionHeight;
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

/** Bbox of one mask plane, full-frame normalized (same convention as the mask-bbox log). */
function getMaskPlaneBox(data: ArrayLike<number>, offset: number, width: number, height: number): MaskCandidate["box"] {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const row = offset + y * width;
    for (let x = 0; x < width; x += 1) {
      if (Number(data[row + x]) > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    return null;
  }
  return { x: minX / width, y: minY / height, width: (maxX - minX + 1) / width, height: (maxY - minY + 1) / height };
}

function selectMask(
  maskTensor: SamTensor | undefined,
  iouScores: SamTensor | undefined,
  boxIndex: number,
  numBoxes: number,
  targetBox: VisualFocusBox,
): SelectedMask | null {
  if (!maskTensor || !maskTensor.dims || maskTensor.dims.length < 2) {
    return null;
  }
  const dims = maskTensor.dims;
  const height = dims[dims.length - 2];
  const width = dims[dims.length - 1];
  const numMasks = dims.length >= 4 ? dims[dims.length - 3] : dims.length === 3 ? dims[0] : 1;
  if (height <= 0 || width <= 0 || numMasks <= 0) {
    return null;
  }

  const planeSize = width * height;
  if ((boxIndex + 1) * numMasks * planeSize > maskTensor.data.length) {
    return null;
  }

  const scores = iouScores?.data;
  const scoreBase = scores ? Math.max(0, scores.length - numBoxes * numMasks) : 0;
  const candidates: MaskCandidate[] = [];
  for (let mask = 0; mask < numMasks; mask += 1) {
    candidates.push({
      box: getMaskPlaneBox(maskTensor.data, (boxIndex * numMasks + mask) * planeSize, width, height),
      samScore: scores ? Number(scores[scoreBase + boxIndex * numMasks + mask]) : 0,
    });
  }
  const picked = pickBestFitMask(candidates, targetBox);
  const best = picked >= 0 ? picked : 0;

  // Per-candidate fit vs SAM score, so a wrong pick can be traced to the selection step.
  const format = (value: number) => value.toFixed(3);
  samLog({
    stage: "mask-select",
    picked: best,
    samTop: candidates.reduce((top, candidate, index) => (candidate.samScore > candidates[top].samScore ? index : top), 0),
    candidates: candidates.map((candidate) => ({
      box: candidate.box ? [candidate.box.x, candidate.box.y, candidate.box.width, candidate.box.height].map(format).join(",") : "empty",
      boxIou: candidate.box ? format(getBoxIou(candidate.box, targetBox)) : "0",
      samScore: format(candidate.samScore),
    })),
  });

  return { data: maskTensor.data, width, height, offset: (boxIndex * numMasks + best) * planeSize };
}

function compositeMaskedCutout(
  frameImage: HTMLImageElement,
  mask: SelectedMask,
  targetBox?: VisualFocusBox,
): Promise<CutoutResult | null> {
  return new Promise((resolve) => {
    try {
      const { width, height } = mask;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) {
        resolve(null);
        return;
      }

      context.drawImage(frameImage, 0, 0, width, height);
      const image = context.getImageData(0, 0, width, height);
      const pixels = image.data;
      const start = mask.offset;

      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      let count = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (Number(mask.data[start + y * width + x]) > 0) {
            count += 1;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          } else {
            pixels[(y * width + x) * 4 + 3] = 0;
          }
        }
      }

      // Raw mask bbox, in mask-pixel dims and frame-normalized coords, logged BEFORE the
      // accept/reject check below so a rejected (too-small/too-large) mask is visible too.
      // Compared against targetBoxNorm (where we told SAM to look), this tells us whether SAM
      // found the right region (bbox overlaps the target) or a wrong one (bbox is elsewhere).
      samLog({
        stage: "mask-bbox",
        maskDims: `${width}x${height}`,
        maskBoxNorm: count > 0
          ? [minX / width, minY / height, (maxX - minX + 1) / width, (maxY - minY + 1) / height]
              .map((v) => v.toFixed(3))
              .join(",")
          : "empty",
        coverage: Number((count / (width * height)).toFixed(4)),
        targetBoxNorm: targetBox
          ? [targetBox.x, targetBox.y, targetBox.width, targetBox.height].map((v) => v.toFixed(3)).join(",")
          : undefined,
      });

      // Reject too-small AND ~whole-frame masks. A mask covering nearly everything isn't an
      // isolation (background kept) and would mislabel the result as "Isolated"; fall back instead.
      if (count < Math.max(64, width * height * 0.004) || count > width * height * 0.92 || maxX <= minX || maxY <= minY) {
        resolve(null);
        return;
      }

      context.putImageData(image, 0, 0);

      const cropX = Math.max(0, minX - 1);
      const cropY = Math.max(0, minY - 1);
      const cropWidth = Math.min(width - cropX, maxX - minX + 3);
      const cropHeight = Math.min(height - cropY, maxY - minY + 3);

      const cutout = document.createElement("canvas");
      cutout.width = cropWidth;
      cutout.height = cropHeight;
      const cutoutContext = cutout.getContext("2d");
      if (!cutoutContext) {
        resolve(null);
        return;
      }
      cutoutContext.filter = "blur(0.6px)"; // light feather on the edge
      cutoutContext.drawImage(canvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

      resolve({
        focusBox: {
          confidence: Math.min(1, Math.max(0.5, (count / (width * height)) * 2)),
          height: clamp01(cropHeight / height),
          width: clamp01(cropWidth / width),
          x: clamp01(cropX / width),
          y: clamp01(cropY / height),
        },
        imageBase64: cutout.toDataURL("image/png"),
      });
    } catch {
      resolve(null);
    }
  });
}

function getSamPipeline(model: string): Promise<SamPipeline> {
  const existing = pipelinesByModel.get(model);
  if (existing) {
    return existing;
  }

  const pipelinePromise = import("@huggingface/transformers")
    .then(async (mod) => {
      const transformers = mod as unknown as SamTransformersModule;
      const rawImage = transformers.RawImage;
      // Surface the installed transformers version + which RawImage loaders exist. If a future
      // upgrade renames/removes read()/fromURL(), this shows up in diagnostics instead of the
      // opaque "this.fromURL is not a function" crash we hit when the API drifts.
      samLog({
        stage: "transformers-version",
        version: transformers.env?.version ?? "unknown",
        rawImageApi: { read: typeof rawImage?.read, fromURL: typeof rawImage?.fromURL, fromBlob: typeof rawImage?.fromBlob },
      });
      const [samModel, processor] = await Promise.all([
        transformers.SamModel.from_pretrained(model, { dtype: getPromptableDtype(), device: "webgpu" }),
        transformers.AutoProcessor.from_pretrained(model),
      ]);
      samLog({ stage: "pipeline-ready", model, dtype: getPromptableDtype() });
      // RawImage.read() dispatches to this.fromURL/this.fromBlob internally, so it must stay bound
      // to the class. Passing the bare method reference drops `this` → "this.fromURL is not a function".
      return { model: samModel, processor, read: (url: string) => rawImage.read(url) };
    })
    .catch((error) => {
      pipelinesByModel.delete(model);
      samLog({ stage: "pipeline-error", model, message: error instanceof Error ? error.message : String(error) });
      throw error;
    });
  pipelinesByModel.set(model, pipelinePromise);
  return pipelinePromise;
}

function canUseBrowserSegmentation() {
  return typeof window !== "undefined"
    && typeof document !== "undefined"
    && typeof Image !== "undefined";
}

function loadHtmlImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
  onError?: (error: unknown) => void,
): Promise<T | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      settled = true;
      onTimeout?.();
      resolve(null);
    }, timeoutMs);
    promise
      .then((value) => {
        if (!settled) {
          window.clearTimeout(timer);
          settled = true;
          resolve(value);
        }
      })
      .catch((error) => {
        if (!settled) {
          window.clearTimeout(timer);
          settled = true;
          // The awaited work rejected. isolateBoxes catches its own errors, so a rejection here
          // is the one path that used to resolve null silently → blank SAM error. Surface it.
          onError?.(error);
          resolve(null);
        }
      });
  });
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function tensorDims(tensor: unknown): number[] | null {
  const dims = (tensor as { dims?: unknown } | null | undefined)?.dims;
  return Array.isArray(dims) ? (dims as number[]) : null;
}

function clock(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

// On-device diagnostics for Steps 5-6 (WebGPU support, model load + inference timings,
// which step fell back). Logged to the console AND mirrored into the debug collector so
// the on-screen overlay can show it without a console.
function samLog(detail: Record<string, unknown>) {
  try {
    console.info("[DeepSpec SAM]", detail);
  } catch {
    // ignore logging failures
  }
  switch (detail.stage) {
    case "load":
      recordScanDebug({ samLoadMs: Number(detail.ms) });
      break;
    case "inference":
      recordScanDebug({ samInferenceMs: Number(detail.ms), samOk: Boolean(detail.ok) });
      break;
    case "raw-output":
      // Surface the cold-time breakdown (model vs post) and output shape on-device, not just console.
      recordScanDebug({
        samModelMs: Number(detail.modelMs),
        samPostMs: Number(detail.postMs),
        samMaskDims: Array.isArray(detail.predMasks) ? (detail.predMasks as number[]).join("×") : undefined,
      });
      break;
    case "inference-timeout":
      // Fires from withTimeout's timer, before the ok:false "inference" log — which only sets
      // samOk/samInferenceMs, so this timeout reason survives instead of leaving samError blank.
      recordScanDebug({ samOk: false, samError: `timeout after ${Number(detail.ms)}ms` });
      break;
    case "pipeline-error":
      recordScanDebug({ samError: typeof detail.message === "string" ? detail.message : "load failed" });
      break;
    case "inference-error":
      recordScanDebug({ samOk: false, samError: typeof detail.message === "string" ? detail.message : "inference failed" });
      break;
    case "inference-empty":
      recordScanDebug({ samOk: false, samError: typeof detail.reason === "string" ? `empty: ${detail.reason}` : "no mask" });
      break;
    case "skip":
      recordScanDebug({ samError: typeof detail.reason === "string" ? `skipped: ${detail.reason}` : "skipped" });
      break;
    case "prompt-geometry":
      recordScanDebug({
        samFrameDims: typeof detail.frameDims === "string" ? detail.frameDims : undefined,
        samModelDims: typeof detail.modelDims === "string" ? detail.modelDims : undefined,
      });
      break;
    case "mask-bbox":
      recordScanDebug({
        samMaskBoxNorm: typeof detail.maskBoxNorm === "string" ? detail.maskBoxNorm : undefined,
        samMaskCoverage: typeof detail.coverage === "number" ? detail.coverage : undefined,
        samTargetBoxNorm: typeof detail.targetBoxNorm === "string" ? detail.targetBoxNorm : undefined,
      });
      break;
    default:
      break;
  }
}
