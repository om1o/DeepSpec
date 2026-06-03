import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_OUT_DIR = "datasets/verified/vehicle-reference-v1";
const DEFAULT_MAKE = "toyota";
const DEFAULT_MODEL = "camry";
const DEFAULT_START_YEAR = 2018;
const DEFAULT_END_YEAR = 2026;
const DATASET_ID = "verified-vehicle-reference-v1";
const NHTSA_API_BASE = "https://vpic.nhtsa.dot.gov/api/vehicles";

const OEM_SOURCE_POINTERS = [
  {
    id: "toyota-tis",
    labels: ["toyota", "camry", "repair manual", "service manual", "wiring diagram", "engine"],
    sourceLicense:
      "OEM subscription/copyrighted service information. Store metadata and links only unless license rights permit content storage or model training.",
    sourceName: "Toyota Technical Information System",
    sourceTier: "tier_1_oem",
    sourceUrl: "https://techinfo.toyota.com/tis/",
    summary:
      "Toyota service support source for repair manuals, wiring diagrams, bulletins, technical training, and other technical information.",
  },
  {
    id: "toyota-parts-center-online",
    labels: ["toyota", "camry", "oem parts", "vin fitment", "part number"],
    sourceLicense:
      "OEM commerce/catalog source. Store metadata and links only unless terms permit diagram or image storage.",
    sourceName: "Toyota Parts Center Online",
    sourceTier: "tier_1_oem",
    sourceUrl: "https://autoparts.toyota.com/",
    summary:
      "Official Toyota parts and accessories storefront with VIN/vehicle selection for genuine Toyota parts.",
  },
  {
    id: "nhtsa-vin-decoder",
    labels: ["nhtsa", "vin", "toyota", "camry", "vehicle identity"],
    sourceLicense: "Public U.S. government vehicle identity source; data is manufacturer-reported through NHTSA vPIC.",
    sourceName: "NHTSA VIN Decoder",
    sourceTier: "tier_1_government",
    sourceUrl: "https://www.nhtsa.gov/vin-decoder",
    summary:
      "Public VIN decoder for manufacturer-reported vehicle identity fields such as make, model, year, plant, and encoded vehicle details.",
  },
];

export async function buildVerifiedVehicleReference(options = {}) {
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (typeof fetcher !== "function") {
    throw new Error("A fetch implementation is required.");
  }

  const make = cleanToken(options.make ?? DEFAULT_MAKE);
  const model = cleanToken(options.model ?? DEFAULT_MODEL);
  const years = parseYears(options.years ?? `${DEFAULT_START_YEAR}-${DEFAULT_END_YEAR}`);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const outDir = resolve(options.outDir ?? DEFAULT_OUT_DIR);

  const vehicleRecords = [];
  const skipped = [];

  for (const modelYear of years) {
    const sourceUrl = buildNhtsaModelsForMakeYearUrl(make, modelYear);
    const rows = await fetchJsonResults(fetcher, sourceUrl);
    const matches = rows.filter((row) => normalize(row.Model_Name) === normalize(model));

    if (!matches.length) {
      skipped.push({ make, model, modelYear, reason: "No exact NHTSA model match." });
      continue;
    }

    for (const row of matches) {
      vehicleRecords.push(toVehicleRecord({ generatedAt, modelYear, row, sourceUrl }));
    }
  }

  const sourceRecords = OEM_SOURCE_POINTERS.map((source) => toSourcePointerRecord({
    generatedAt,
    model,
    source,
  }));

  const records = [...vehicleRecords, ...sourceRecords].sort(compareRecords);
  const labels = collectLabels(records);
  const manifest = {
    datasetId: DATASET_ID,
    generatedAt,
    target: {
      make,
      model,
      years,
    },
    outDir: normalizePath(relative(process.cwd(), outDir)),
    recordCount: records.length,
    skipped,
    sourcePolicy: "docs/VERIFIED_SOURCE_POLICY.md",
    sources: [
      {
        sourceName: "NHTSA vPIC API",
        sourceTier: "tier_1_government",
        sourceUrl: "https://vpic.nhtsa.dot.gov/api/",
        use: "Downloaded manufacturer-reported make/model/model-year records to constrain vehicle identity.",
      },
      ...OEM_SOURCE_POINTERS.map((source) => ({
        sourceName: source.sourceName,
        sourceTier: source.sourceTier,
        sourceUrl: source.sourceUrl,
        use: "Stored as metadata-only pointer. Content is not downloaded for training until usage rights are verified.",
      })),
    ],
    totalLabels: labels.length,
  };

  await writeJson(join(outDir, "manifest.json"), manifest);
  await writeJsonl(join(outDir, "records.jsonl"), records);
  await writeLabelIndexes(outDir, labels, records);

  return {
    manifest,
    records,
  };
}

function toVehicleRecord({ generatedAt, modelYear, row, sourceUrl }) {
  const make = cleanDisplay(row.Make_Name);
  const model = cleanDisplay(row.Model_Name);
  const primaryLabel = `${make} ${model} ${modelYear}`;

  return {
    id: stableId(`nhtsa:${row.Make_ID}:${row.Model_ID}:${modelYear}`),
    canonicalKind: "vehicle_model_year",
    datasetId: DATASET_ID,
    downloaded: true,
    evidenceClues: [
      "NHTSA vPIC manufacturer-reported make/model/model-year record.",
      "Use this as a vehicle identity constraint, not as visual engine-photo proof.",
    ],
    labels: [
      normalize(make),
      normalize(model),
      String(modelYear),
      "vehicle_identity",
      "manufacturer_reported",
    ],
    primaryLabel,
    retrievalUse: ["constrain_vehicle_context", "validate_make_model_year"],
    sourceEngineCode: null,
    sourceLicense: "Public U.S. government API; vehicle fields are manufacturer-reported through NHTSA vPIC.",
    sourceName: "NHTSA vPIC API",
    sourcePartName: null,
    sourcePartNumber: null,
    sourceRetrievedAt: generatedAt,
    sourceTier: "tier_1_government",
    sourceUrl,
    sourceVehicle: {
      make,
      makeId: Number(row.Make_ID),
      model,
      modelId: Number(row.Model_ID),
      modelYear,
    },
    trainingAllowed: false,
    verificationStatus: "constrained",
  };
}

function toSourcePointerRecord({ generatedAt, model, source }) {
  return {
    id: stableId(`source:${source.id}:${model}`),
    canonicalKind: "verified_source_pointer",
    datasetId: DATASET_ID,
    downloaded: false,
    evidenceClues: [
      source.summary,
      "Metadata-only source pointer. Do not train on source content until license rights are confirmed.",
    ],
    labels: [...new Set(source.labels.map(normalize))].sort((a, b) => a.localeCompare(b)),
    primaryLabel: source.sourceName,
    retrievalUse: ["source_lookup", "manual_review", "fitment_verification"],
    sourceEngineCode: null,
    sourceLicense: source.sourceLicense,
    sourceName: source.sourceName,
    sourcePartName: null,
    sourcePartNumber: null,
    sourceRetrievedAt: generatedAt,
    sourceTier: source.sourceTier,
    sourceUrl: source.sourceUrl,
    sourceVehicle: {
      make: "Toyota",
      model: cleanDisplay(model),
      modelYear: null,
    },
    trainingAllowed: false,
    verificationStatus: "verified",
  };
}

async function fetchJsonResults(fetcher, sourceUrl) {
  const response = await fetcher(sourceUrl);
  if (!response.ok) {
    throw new Error(`Could not fetch ${sourceUrl}: HTTP ${response.status}`);
  }

  const payload = await response.json();
  return Array.isArray(payload.Results) ? payload.Results : [];
}

function buildNhtsaModelsForMakeYearUrl(make, modelYear) {
  return `${NHTSA_API_BASE}/GetModelsForMakeYear/make/${encodeURIComponent(make)}/modelyear/${modelYear}?format=json`;
}

function collectLabels(records) {
  return [...new Set(records.flatMap((record) => record.labels))].sort((a, b) => a.localeCompare(b));
}

async function writeLabelIndexes(outDir, labels, records) {
  for (const label of labels) {
    const matching = records.filter((record) => record.labels.includes(label));
    await writeJson(join(outDir, "by-label", slugify(label), "records.json"), {
      count: matching.length,
      label,
      records: matching.map((record) => record.id),
    });
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeJsonl(path, values) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${values.map((value) => JSON.stringify(value)).join("\n")}\n`);
}

function parseYears(value) {
  const raw = Array.isArray(value) ? value.join(",") : String(value);
  const years = new Set();

  for (const segment of raw.split(",")) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const range = trimmed.match(/^(\d{4})-(\d{4})$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      for (let year = Math.min(start, end); year <= Math.max(start, end); year += 1) {
        years.add(year);
      }
      continue;
    }

    const year = Number(trimmed);
    if (Number.isInteger(year)) {
      years.add(year);
    }
  }

  return [...years].filter((year) => year >= 1995 && year <= 2100).sort((a, b) => a - b);
}

function cleanToken(value) {
  return String(value).trim().toLowerCase();
}

function cleanDisplay(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "Unknown";
  return raw.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function compareRecords(a, b) {
  return a.canonicalKind.localeCompare(b.canonicalKind)
    || a.primaryLabel.localeCompare(b.primaryLabel)
    || a.id.localeCompare(b.id);
}

function stableId(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `verified-${(hash >>> 0).toString(36)}`;
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

function parseArgs(args) {
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name, inlineValue] = arg.split("=");
    const value = inlineValue ?? args[index + 1];

    if (name === "--make") {
      options.make = value;
      if (!inlineValue) index += 1;
    } else if (name === "--model") {
      options.model = value;
      if (!inlineValue) index += 1;
    } else if (name === "--years") {
      options.years = value;
      if (!inlineValue) index += 1;
    } else if (name === "--out-dir") {
      options.outDir = value;
      if (!inlineValue) index += 1;
    } else if (name === "--help" || name === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/build-verified-vehicle-reference.mjs [options]

Options:
  --make <make>       Target make. Default: ${DEFAULT_MAKE}
  --model <model>     Target model family. Default: ${DEFAULT_MODEL}
  --years <years>     Year list/range, e.g. 2018-2026 or 2020,2021. Default: ${DEFAULT_START_YEAR}-${DEFAULT_END_YEAR}
  --out-dir <path>    Output directory. Default: ${DEFAULT_OUT_DIR}
`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await buildVerifiedVehicleReference(parseArgs(process.argv.slice(2)));
  console.log(`Wrote ${result.manifest.recordCount} verified reference records.`);
  console.log(`Manifest: ${join(result.manifest.outDir, "manifest.json")}`);
}
