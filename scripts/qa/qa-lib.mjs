import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { inflateSync } from "node:zlib";

export const QA_ARTIFACT_DIR = resolve("artifacts", "qa");
export const DOCTOR_CLASSIFICATIONS = [
  "real product bug",
  "test bug",
  "stale environment",
  "missing env",
  "auth/session issue",
  "browser/VNC/screenshot failure",
  "network/transient issue",
  "unknown",
];

export async function writeTextArtifact(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

export async function writeJsonArtifact(path, data) {
  await writeTextArtifact(path, `${JSON.stringify(data, null, 2)}\n`);
}

export async function ensureArtifactDir(path) {
  await mkdir(path, { recursive: true });
}

export function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    shell: false,
  });

  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `git ${args.join(" ")} failed`;
    throw new Error(detail);
  }

  return result.stdout.trim();
}

export function loadLocalEnv(filenames = [".env.local", ".env"]) {
  for (const filename of filenames) {
    const path = resolve(filename);
    if (!existsSync(path)) {
      continue;
    }

    const body = readFileSync(path, "utf8");
    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const equalsIndex = trimmed.indexOf("=");
      if (equalsIndex === -1) {
        continue;
      }

      const key = trimmed.slice(0, equalsIndex).trim();
      const rawValue = trimmed.slice(equalsIndex + 1).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }

      process.env[key] = unwrapEnvValue(rawValue);
    }
  }
}

export function readPackageJson() {
  return JSON.parse(readFileSync(resolve("package.json"), "utf8"));
}

export function hasStorybookSupport(packageJson = readPackageJson()) {
  const scripts = packageJson.scripts ?? {};
  const deps = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
  };

  return Boolean(
    existsSync(resolve(".storybook"))
      || Object.keys(scripts).some((name) => name.toLowerCase().includes("storybook"))
      || Object.keys(deps).some((name) => name.toLowerCase().includes("storybook")),
  );
}

export async function importPlaywright() {
  try {
    return { module: await import("playwright"), error: null };
  } catch (error) {
    return { module: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export function getQaBaseUrl() {
  const sources = [
    ["DEEPSPEC_QA_BASE_URL", process.env.DEEPSPEC_QA_BASE_URL],
    ["PLAYWRIGHT_BASE_URL", process.env.PLAYWRIGHT_BASE_URL],
    ["QA_BASE_URL", process.env.QA_BASE_URL],
  ];
  const configured = sources.find(([, value]) => value?.trim());

  return {
    configured: Boolean(configured),
    source: configured?.[0] ?? "default",
    url: configured?.[1]?.trim() || "http://127.0.0.1:5174",
  };
}

export function withTimeout(promise, timeoutMs, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timeoutId);
  });
}

export function normalizeSlug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "item";
}

export function markdownTableCell(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

export function formatMarkdownList(values, fallback = "- none") {
  const cleanValues = values.filter(Boolean);
  if (!cleanValues.length) {
    return fallback;
  }

  return cleanValues.map((value) => `- ${value}`).join("\n");
}

export function isDirectRun(url) {
  return process.argv[1] && fileURLToPath(url) === process.argv[1];
}

export function getCheckSummary(checks) {
  const failures = checks.filter((check) => check.status === "failed");
  const warnings = checks.filter((check) => check.status === "warning");
  const classification = pickDoctorClassification(failures);

  return {
    canClaimProductBug: failures.length === 0 || failures.every((check) => check.classification === "real product bug"),
    classification,
    failed: failures.length,
    passed: checks.filter((check) => check.status === "passed").length,
    status: failures.length ? "failed" : "passed",
    warnings: warnings.length,
  };
}

export function pickDoctorClassification(failures) {
  if (!failures.length) {
    return "unknown";
  }

  const priority = [
    "missing env",
    "stale environment",
    "auth/session issue",
    "browser/VNC/screenshot failure",
    "test bug",
    "network/transient issue",
    "real product bug",
    "unknown",
  ];

  for (const classification of priority) {
    if (failures.some((failure) => failure.classification === classification)) {
      return classification;
    }
  }

  return "unknown";
}

export function classifyRunnerOutcome(doctorSummary, issueType) {
  if (issueType === "passed") {
    return "passed";
  }

  if (!doctorSummary.canClaimProductBug) {
    if (doctorSummary.classification === "test bug" || doctorSummary.classification === "browser/VNC/screenshot failure") {
      return "test issue";
    }

    return "environment issue";
  }

  if (issueType === "test") {
    return "test issue";
  }

  if (issueType === "environment") {
    return "environment issue";
  }

  if (issueType === "product") {
    return "real product bug";
  }

  return "inconclusive";
}

export function isPngMostlyBlank(buffer) {
  try {
    const image = decodePng(buffer);
    const sampleEvery = Math.max(1, Math.floor((image.width * image.height) / 10_000));
    const seen = new Set();
    let sampled = 0;
    let nonTransparent = 0;

    for (let pixel = 0; pixel < image.width * image.height; pixel += sampleEvery) {
      const offset = pixel * 4;
      const alpha = image.pixels[offset + 3];
      if (alpha > 10) {
        nonTransparent += 1;
      }

      seen.add(`${image.pixels[offset]},${image.pixels[offset + 1]},${image.pixels[offset + 2]},${alpha}`);
      sampled += 1;
    }

    return nonTransparent === 0 || seen.size <= 2 || sampled === 0;
  } catch {
    return buffer.length < 1_000;
  }
}

function unwrapEnvValue(value) {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

function decodePng(buffer) {
  const signature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== signature) {
    throw new Error("Not a PNG.");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  if (bitDepth !== 8 || ![2, 6].includes(colorType) || !width || !height) {
    throw new Error("Unsupported PNG format.");
  }

  const channels = colorType === 6 ? 4 : 3;
  const bytesPerPixel = channels;
  const rowSize = width * channels;
  const raw = inflateSync(Buffer.concat(idatChunks));
  const pixels = Buffer.alloc(width * height * 4);
  let rawOffset = 0;
  let pixelOffset = 0;
  let previousRow = Buffer.alloc(rowSize);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset];
    rawOffset += 1;
    const row = Buffer.from(raw.subarray(rawOffset, rawOffset + rowSize));
    rawOffset += rowSize;
    unfilterRow(row, previousRow, filter, bytesPerPixel);

    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      pixels[pixelOffset] = row[source];
      pixels[pixelOffset + 1] = row[source + 1];
      pixels[pixelOffset + 2] = row[source + 2];
      pixels[pixelOffset + 3] = channels === 4 ? row[source + 3] : 255;
      pixelOffset += 4;
    }

    previousRow = row;
  }

  return { height, pixels, width };
}

function unfilterRow(row, previousRow, filter, bytesPerPixel) {
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
    const up = previousRow[index] ?? 0;
    const upLeft = index >= bytesPerPixel ? previousRow[index - bytesPerPixel] ?? 0 : 0;

    if (filter === 1) {
      row[index] = (row[index] + left) & 255;
    } else if (filter === 2) {
      row[index] = (row[index] + up) & 255;
    } else if (filter === 3) {
      row[index] = (row[index] + Math.floor((left + up) / 2)) & 255;
    } else if (filter === 4) {
      row[index] = (row[index] + paeth(left, up, upLeft)) & 255;
    } else if (filter !== 0) {
      throw new Error(`Unsupported PNG filter ${filter}.`);
    }
  }
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);

  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) {
    return left;
  }

  if (upDistance <= upLeftDistance) {
    return up;
  }

  return upLeft;
}
