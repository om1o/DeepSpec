import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_RAW_DIR = "datasets/raw/drbimmer-car-parts-and-damage-dataset";
const DEFAULT_OUT_DIR = "datasets/derived/drbimmer-car-parts-and-damage-dataset";
const DATASET_ID = "DrBimmer/car-parts-and-damage-dataset";

const RAW_GROUPS = [
  {
    canonicalKind: "part",
    rawName: "Car damages dataset",
  },
  {
    canonicalKind: "damage",
    rawName: "Car parts dataset",
  },
];

export async function sortDrBimmerDataset(options = {}) {
  const rawDir = resolve(options.rawDir ?? DEFAULT_RAW_DIR);
  const outDir = resolve(options.outDir ?? DEFAULT_OUT_DIR);
  const linkMode = options.linkMode ?? "symlink";
  const groups = [];
  const missing = [];

  for (const group of RAW_GROUPS) {
    const rawGroupDir = join(rawDir, group.rawName);
    const metaPath = join(rawGroupDir, "meta.json");
    const imgDir = join(rawGroupDir, "File1", "img");
    const annDir = join(rawGroupDir, "File1", "ann");
    const maskDir = join(rawGroupDir, "File1", "masks_machine");
    const groupMissing = [];

    for (const path of [metaPath, imgDir, annDir, maskDir]) {
      if (!existsSync(path)) {
        missing.push(path);
        groupMissing.push(path);
      }
    }

    if (groupMissing.length) {
      continue;
    }

    const labels = await readClassTitles(metaPath);
    const records = await buildRecords({
      annDir,
      canonicalKind: group.canonicalKind,
      imgDir,
      labels,
      maskDir,
      outDir,
      rawGroupDir,
      rawName: group.rawName,
    });

    groups.push({
      canonicalKind: group.canonicalKind,
      rawName: group.rawName,
      labels,
      records,
    });
  }

  if (missing.length) {
    return {
      ok: false,
      message: "Raw dataset is incomplete. Let the Hugging Face download finish, then run this command again.",
      missing,
      rawDir,
    };
  }

  await mkdir(outDir, { recursive: true });
  const allRecords = groups.flatMap((group) => group.records);
  const manifest = {
    datasetId: DATASET_ID,
    generatedAt: new Date().toISOString(),
    rawDir,
    outDir,
    linkMode,
    groups: groups.map((group) => ({
      canonicalKind: group.canonicalKind,
      rawName: group.rawName,
      labels: group.labels,
      recordCount: group.records.length,
    })),
    totalRecords: allRecords.length,
  };

  await writeJson(join(outDir, "manifest.json"), manifest);
  await writeJsonl(join(outDir, "records.jsonl"), allRecords);
  await writeLabelIndexes(outDir, allRecords);
  await writeLinks({ allRecords, linkMode, outDir });

  return {
    ok: true,
    manifest,
  };
}

async function buildRecords({ annDir, canonicalKind, imgDir, labels, maskDir, outDir, rawGroupDir, rawName }) {
  const annotationNames = await listFiles(annDir, ".json");
  const records = [];

  for (const annotationName of annotationNames) {
    const annotationPath = join(annDir, annotationName);
    const annotation = await readJson(annotationPath);
    const imageName = annotationName.replace(/\.json$/i, "");
    const imagePath = findExistingImage(imgDir, imageName);
    const maskPath = findExistingImage(maskDir, imageName);
    const objectLabels = extractObjectLabels(annotation, labels);
    const primaryLabel = objectLabels[0] ?? labels[0] ?? "unlabeled";

    records.push({
      id: stableId(`${rawName}/${imageName}`),
      datasetId: DATASET_ID,
      canonicalKind,
      rawGroupName: rawName,
      primaryLabel,
      labels: objectLabels,
      image: imagePath ? normalizePath(relative(outDir, imagePath)) : null,
      annotation: normalizePath(relative(outDir, annotationPath)),
      mask: maskPath ? normalizePath(relative(outDir, maskPath)) : null,
      source: {
        image: imagePath ? normalizePath(relative(rawGroupDir, imagePath)) : null,
        annotation: normalizePath(relative(rawGroupDir, annotationPath)),
        mask: maskPath ? normalizePath(relative(rawGroupDir, maskPath)) : null,
      },
    });
  }

  return records.sort((a, b) => a.id.localeCompare(b.id));
}

async function writeLabelIndexes(outDir, records) {
  const byLabel = new Map();
  for (const record of records) {
    for (const label of record.labels.length ? record.labels : [record.primaryLabel]) {
      const key = `${record.canonicalKind}:${label}`;
      const items = byLabel.get(key) ?? [];
      items.push(record);
      byLabel.set(key, items);
    }
  }

  for (const [key, items] of byLabel.entries()) {
    const [kind, label] = key.split(":");
    const labelDir = join(outDir, "by-label", kind, slugify(label));
    await mkdir(labelDir, { recursive: true });
    await writeJson(join(labelDir, "records.json"), {
      kind,
      label,
      count: items.length,
      records: items.map((item) => item.id),
    });
  }
}

async function writeLinks({ allRecords, linkMode, outDir }) {
  if (linkMode === "none") {
    return;
  }

  for (const record of allRecords) {
    if (!record.image) continue;
    const labelDir = join(outDir, "by-label", record.canonicalKind, slugify(record.primaryLabel), "images");
    await mkdir(labelDir, { recursive: true });
    const sourcePath = resolve(outDir, record.image);
    const targetPath = join(labelDir, `${record.id}${extensionOf(sourcePath)}`);
    if (!existsSync(targetPath)) {
      await symlink(sourcePath, targetPath, "file");
    }
  }
}

function extractObjectLabels(annotation, fallbackLabels) {
  const labels = new Set();
  const objects = Array.isArray(annotation?.objects) ? annotation.objects : [];
  for (const object of objects) {
    if (object && typeof object.classTitle === "string" && object.classTitle.trim()) {
      labels.add(object.classTitle.trim());
    }
  }

  if (!labels.size && fallbackLabels.length === 1) {
    labels.add(fallbackLabels[0]);
  }

  return [...labels].sort((a, b) => a.localeCompare(b));
}

async function readClassTitles(metaPath) {
  const meta = await readJson(metaPath);
  const classes = Array.isArray(meta.classes) ? meta.classes : [];
  return classes
    .map((item) => (item && typeof item.title === "string" ? item.title.trim() : ""))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

async function listFiles(dir, suffix) {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(suffix))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function findExistingImage(dir, basename) {
  for (const ext of ["", ".png", ".jpg", ".jpeg"]) {
    const candidate = join(dir, `${basename}${ext}`);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeJsonl(path, values) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${values.map((value) => JSON.stringify(value)).join("\n")}\n`);
}

function stableId(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `drb-${(hash >>> 0).toString(36)}`;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizePath(path) {
  return path.replaceAll("\\", "/");
}

function extensionOf(path) {
  const match = path.match(/\.[^.\\/]+$/);
  return match ? match[0] : "";
}

function parseArgs(args) {
  const options = {
    linkMode: "symlink",
    outDir: DEFAULT_OUT_DIR,
    rawDir: DEFAULT_RAW_DIR,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name, inlineValue] = arg.split("=");
    const value = inlineValue ?? args[index + 1];

    if (name === "--raw-dir") {
      options.rawDir = value;
      if (!inlineValue) index += 1;
    } else if (name === "--out-dir") {
      options.outDir = value;
      if (!inlineValue) index += 1;
    } else if (name === "--link-mode") {
      if (value !== "symlink" && value !== "none") {
        throw new Error("--link-mode must be symlink or none.");
      }
      options.linkMode = value;
      if (!inlineValue) index += 1;
    } else if (name === "--help" || name === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/sort-drbimmer-dataset.mjs [options]

Options:
  --raw-dir <path>       Raw Hugging Face download folder. Default: ${DEFAULT_RAW_DIR}
  --out-dir <path>       Derived sorted output folder. Default: ${DEFAULT_OUT_DIR}
  --link-mode <mode>     symlink or none. Default: symlink
`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await sortDrBimmerDataset(parseArgs(process.argv.slice(2)));
  if (!result.ok) {
    console.error(result.message);
    console.error("Missing:");
    for (const path of result.missing.slice(0, 12)) {
      console.error(`- ${path}`);
    }
    if (result.missing.length > 12) {
      console.error(`- ...and ${result.missing.length - 12} more`);
    }
    process.exit(1);
  }

  console.log(`Sorted ${result.manifest.totalRecords} records.`);
  for (const group of result.manifest.groups) {
    console.log(`${group.canonicalKind}: ${group.recordCount} records, ${group.labels.length} labels`);
  }
  console.log(`Manifest: ${join(result.manifest.outDir, "manifest.json")}`);
}
