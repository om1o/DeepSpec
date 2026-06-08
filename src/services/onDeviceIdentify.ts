import { SCAN_CATEGORIES, type CapturedFrame, type IdentificationResult, type ScanCategory } from "../types";

// Small vision-language model that runs fully in the browser (WebGPU, WASM fallback).
// The weights download once on first use and are cached by the browser, so later
// scans work with no network. This is an OFFLINE FALLBACK only — the cloud chain
// stays primary and gives the full Deep Spec analysis whenever there is a connection.
const ON_DEVICE_MODEL = "HuggingFaceTB/SmolVLM-256M-Instruct";
const ON_DEVICE_PROMPT =
  "Identify the single main car part in this photo. Answer in one line as: " +
  "part: <specific part name>; category: <one of " +
  SCAN_CATEGORIES.join(", ") +
  ">; note: <one short visible observation>.";
const MAX_NEW_TOKENS = 128;

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
    generatorPromise = loadGenerator();
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
    ) => Promise<(input: unknown, options?: Record<string, unknown>) => Promise<unknown>>;
  };
  const device = (await supportsWebGpu()) ? "webgpu" : "wasm";
  const pipe = await transformers.pipeline("image-text-to-text", ON_DEVICE_MODEL, {
    device,
    dtype: "q4",
    progress_callback: (event: { status?: string; progress?: number }) => {
      if (event?.status === "progress" && typeof event.progress === "number") {
        emitProgress({ stage: "downloading", percent: Math.min(100, Math.max(0, Math.round(event.progress))) });
      }
    },
  });
  emitProgress({ stage: "ready", percent: 100 });

  return async (imageUrl, prompt) => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "image", image: imageUrl },
          { type: "text", text: prompt },
        ],
      },
    ];
    const output = await pipe(messages, { max_new_tokens: MAX_NEW_TOKENS });
    return extractGeneratedText(output);
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
  const text = await generate(frame.imageBase64, ON_DEVICE_PROMPT);
  const latencyMs = typeof performance !== "undefined" ? Math.round(performance.now() - startedAt) : 0;
  const result = mapOnDeviceTextToResult(text);
  if (result.modelRun) {
    result.modelRun.latencyMs = latencyMs;
  }

  return result;
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

function firstMeaningfulLine(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
