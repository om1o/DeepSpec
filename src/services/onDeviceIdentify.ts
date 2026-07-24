import { SCAN_CATEGORIES, type CapturedFrame, type IdentificationResult, type ScanCategory } from "../types";

// Small zero-shot image classifier that runs fully in the browser (WebGPU, WASM fallback).
// The weights download once on first use and are cached by the browser, so later
// scans work with no network. This is an OFFLINE FALLBACK only — the cloud chain
// stays primary and gives the full Deep Spec analysis whenever there is a connection.
const ON_DEVICE_MODEL = "Xenova/clip-vit-base-patch32";
const ON_DEVICE_LABELS = [
  "car damage on fender",
  "damaged front fender",
  "damaged car fender",
  "front fender",
  "damaged rear fender",
  "rear fender",
  "broken car front bumper",
  "damaged front bumper",
  "front bumper",
  "headlight",
  "broken car tail light",
  "tail light",
  "damaged car side mirror",
  "broken side mirror",
  "side mirror",
  "car disc brake",
  "disc brake",
  "brake rotor",
  "brake caliper",
  "car radiator close up",
  "car radiator",
  "radiator",
  "engine assembly",
];

export function isOnDeviceFallbackEnabled() {
  return import.meta.env.VITE_ENABLE_ON_DEVICE_FALLBACK === "true";
}

export type OnDeviceModelProgress = { stage: "downloading" | "ready"; percent: number };
type ProgressListener = (progress: OnDeviceModelProgress) => void;
const progressListeners = new Set<ProgressListener>();

// Lets the UI show first-run download progress (the model is ~150-250MB the first time).
export function onOnDeviceModelProgress(listener: ProgressListener) {
  progressListeners.add(listener);
  return () => {
    progressListeners.delete(listener);
  };
}

function emitProgress(progress: OnDeviceModelProgress) {
  progressListeners.forEach((listener) => listener(progress));
}

type OnDeviceGenerator = (imageUrl: string, prompt: string) => Promise<string>;

// Lazy singleton: transformers.js and the model load only the first time we need them.
let generatorPromise: Promise<OnDeviceGenerator> | null = null;

async function getGenerator(): Promise<OnDeviceGenerator> {
  if (!generatorPromise) {
    generatorPromise = loadGenerator().catch((error: unknown) => {
      generatorPromise = null;
      throw error;
    });
  }

  return generatorPromise;
}

async function loadGenerator(): Promise<OnDeviceGenerator> {
  // Loosely typed at the boundary: the library is heavy, dynamically imported, and only
  // exercised in a real browser, so we depend on its runtime shape rather than its types.
  const transformers = (await import("@huggingface/transformers")) as unknown as {
    pipeline: (
      task: string,
      model: string,
      options?: Record<string, unknown>,
    ) => Promise<(input: string, labels: string[], options?: Record<string, unknown>) => Promise<unknown>>;
  };
  const device = (await supportsWebGpu()) ? "webgpu" : "wasm";
  const pipe = await transformers.pipeline("zero-shot-image-classification", ON_DEVICE_MODEL, {
    device,
    dtype: "q4",
    progress_callback: (event: { status?: string; progress?: number }) => {
      if (event?.status === "progress" && typeof event.progress === "number") {
        emitProgress({ stage: "downloading", percent: Math.min(100, Math.max(0, Math.round(event.progress))) });
      }
    },
  });
  emitProgress({ stage: "ready", percent: 100 });

  return async (imageUrl) => {
    const output = await pipe(imageUrl, ON_DEVICE_LABELS, {
      hypothesis_template: "This is a photo of a car {}",
    });
    return extractZeroShotLabelText(output);
  };
}

async function supportsWebGpu() {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  if (!gpu) {
    return false;
  }

  try {
    return Boolean(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

export async function identifyOnDevice(frame: CapturedFrame): Promise<IdentificationResult> {
  const generate = await getGenerator();
  const startedAt = typeof performance !== "undefined" ? performance.now() : 0;
  const text = await generate(frame.imageBase64, "");
  const latencyMs = typeof performance !== "undefined" ? Math.round(performance.now() - startedAt) : 0;
  const result = mapOnDeviceTextToResult(text);
  if (result.modelRun) {
    result.modelRun.latencyMs = latencyMs;
  }

  return result;
}

export function extractZeroShotLabelText(output: unknown): string {
  const first = Array.isArray(output) ? output[0] : null;
  if (!isRecord(first) || typeof first.label !== "string") {
    return "";
  }

  const label = first.label.trim();
  const score = typeof first.score === "number" && Number.isFinite(first.score)
    ? Math.max(0, Math.min(100, Math.round(first.score * 100)))
    : null;
  const category = categorizeOnDeviceLabel(label);
  const note = score === null ? "on-device visual fallback" : `on-device visual fallback, ${score}% label score`;
  return `part: ${label}; category: ${category}; note: ${note}`;
}

// transformers.js pipelines return [{ generated_text }] where, for chat input,
// generated_text is the message list and the assistant reply is the last entry.
export function extractGeneratedText(output: unknown): string {
  const first = Array.isArray(output) ? output[0] : output;
  if (!isRecord(first)) {
    return typeof output === "string" ? output : "";
  }

  const generated = first.generated_text;
  if (typeof generated === "string") {
    return generated.trim();
  }

  if (Array.isArray(generated)) {
    const last = generated[generated.length - 1];
    const content = isRecord(last) ? last.content : undefined;
    if (typeof content === "string") {
      return content.trim();
    }

    if (Array.isArray(content)) {
      return content
        .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
        .join("")
        .trim();
    }
  }

  return "";
}

export function mapOnDeviceTextToResult(text: string): IdentificationResult {
  const partName = (parseField(text, "part") || firstMeaningfulLine(text) || "Unidentified part").slice(0, 120);
  const note = parseField(text, "note");

  return {
    partName,
    confidence: "low",
    scanCategory: matchCategory(text),
    candidateMatches: [],
    whatItDoes: "",
    visibleObservations: note ? [note] : [],
    evidenceRegions: [],
    concerns: [],
    safetyTriage: "can_help",
    isSafetyCritical: false,
    nextAction: "Offline estimate from the on-device model. Reconnect for a full Deep Spec analysis.",
    needsBetterPhoto: false,
    evidence: [],
    sourceLinks: [],
    modelRun: {
      provider: "on-device",
      model: ON_DEVICE_MODEL,
      latencyMs: 0,
      fallbackReason: "offline",
      ocrUsed: false,
    },
  };
}

function parseField(text: string, field: string) {
  const match = new RegExp(`${field}\\s*:\\s*([^;\\n]+)`, "i").exec(text);
  return match ? match[1].trim() : "";
}

function matchCategory(text: string): ScanCategory {
  const explicit = parseField(text, "category").toLowerCase();
  const direct = SCAN_CATEGORIES.find((category) => category === explicit);
  if (direct) {
    return direct;
  }

  const lower = text.toLowerCase();
  const mentioned = SCAN_CATEGORIES.find((category) => category !== "unknown" && lower.includes(category));
  return mentioned ?? "unknown";
}

function categorizeOnDeviceLabel(label: string): ScanCategory {
  const lower = label.toLowerCase();
  if (/brake|rotor|caliper/.test(lower)) return "brakes";
  if (/battery|alternator|starter/.test(lower)) return "electrical";
  if (/radiator|engine/.test(lower)) return "engine";
  if (/fender|bumper|headlight|tail\s*light|mirror|wheel|tire|hood|door|panel|grille/.test(lower)) return "body";
  return matchCategory(label);
}

function firstMeaningfulLine(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
