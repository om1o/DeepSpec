import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_OUT_DIR = "datasets/verified/hf-automotive-sources-v1";
const ALLOWED_LICENSES = new Set(["mit", "apache-2.0"]);

export const HF_AUTOMOTIVE_SOURCES = [
  {
    datasetId: "AshimaVinod/car-parts-and-damage-dataset",
    labelGroups: {
      damage: ["dent", "scratch", "crack", "broken damage", "missing part", "paint chip", "rust"],
      part: ["front bumper", "rear bumper", "front fender", "door", "hood", "headlight", "grille", "mirror"],
    },
  },
  {
    datasetId: "SaiVaibhavS/comprehensive-car-damage",
    labelGroups: {
      damage: ["front crushed damage", "rear crushed damage", "front breakage", "rear breakage", "front normal", "rear normal"],
    },
  },
  {
    datasetId: "DrBimmer/comprehensive-car-damage",
    labelGroups: {
      damage: ["front crushed damage", "rear crushed damage", "front breakage", "rear breakage", "front normal", "rear normal"],
    },
  },
  {
    datasetId: "Abijith/car-damage-segmentation-small",
    labelGroups: {
      damage: ["car damage segmentation", "scratch", "dent", "crack"],
    },
  },
  {
    datasetId: "Reverb/CarDamage",
    labelGroups: {
      damage: ["car damage", "front damage", "rear damage", "body damage"],
    },
  },
];

export async function buildHfAutomotiveSources(options = {}) {
  const outDir = resolve(options.outDir ?? DEFAULT_OUT_DIR);
  const fetcher = options.fetcher ?? fetch;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const records = [];
  const sources = [];
  const skipped = [];

  for (const source of options.sources ?? HF_AUTOMOTIVE_SOURCES) {
    const metadata = await fetchDatasetMetadata(source.datasetId, fetcher);
    const license = getDatasetLicense(metadata, source.license);
    const datasetUrl = `https://huggingface.co/datasets/${source.datasetId}`;

    if (!license || !ALLOWED_LICENSES.has(license)) {
      skipped.push({
        datasetId: source.datasetId,
        datasetUrl,
        license: license || "unknown",
        reason: "License is not allow-listed for DeepSpec source context.",
      });
      continue;
    }

    const size = await fetchDatasetSize(source.datasetId, fetcher);
    const sourceSummary = {
      datasetId: source.datasetId,
      datasetUrl,
      downloads: getNumber(metadata?.downloads),
      license,
      sizeCategory: getTagValue(metadata?.tags, "size_categories"),
      taskCategories: getTagValues(metadata?.tags, "task_categories"),
      totalRows: size?.totalRows ?? null,
    };
    sources.push(sourceSummary);

    for (const [canonicalKind, labels] of Object.entries(source.labelGroups)) {
      for (const label of labels) {
        records.push({
          id: stableId(`${source.datasetId}:${canonicalKind}:${label}`),
          canonicalKind,
          datasetId: source.datasetId,
          datasetUrl,
          labels: [label],
          license,
          links: {
            dataset: datasetUrl,
          },
          primaryLabel: label,
          reviewStatus: "source_catalog",
          sampleCount: sourceSummary.totalRows,
          source: {
            downloads: sourceSummary.downloads,
            sizeCategory: sourceSummary.sizeCategory,
            taskCategories: sourceSummary.taskCategories,
          },
          trainingAllowed: true,
          trainingLabel: label,
          verificationStatus: "source_catalog",
        });
      }
    }
  }

  records.sort((a, b) => a.id.localeCompare(b.id));
  await mkdir(outDir, { recursive: true });
  await writeJson(join(outDir, "manifest.json"), {
    datasetId: "hf-automotive-sources-v1",
    generatedAt,
    recordCount: records.length,
    skipped,
    sources,
  });
  await writeJsonl(join(outDir, "records.jsonl"), records);
  await writeLabelIndexes(outDir, records);

  return {
    manifest: {
      recordCount: records.length,
      skipped,
      sources,
    },
    records,
  };
}

async function fetchDatasetMetadata(datasetId, fetcher) {
  const response = await fetcher(`https://huggingface.co/api/datasets/${datasetId}`, {
    headers: { "User-Agent": "DeepSpec source-catalog builder" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response?.ok) {
    return null;
  }

  return response.json();
}

async function fetchDatasetSize(datasetId, fetcher) {
  const response = await fetcher(`https://datasets-server.huggingface.co/size?dataset=${encodeURIComponent(datasetId)}`, {
    headers: { "User-Agent": "DeepSpec source-catalog builder" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response?.ok) {
    return null;
  }

  const body = await response.json();
  const splitRows = getDatasetSplitRows(body);
  const totalRows = splitRows.length ? splitRows.reduce((sum, rowCount) => sum + rowCount, 0) : null;

  return { totalRows };
}

function getDatasetSplitRows(body) {
  if (Array.isArray(body?.size?.splits)) {
    return body.size.splits.map((split) => getNumber(split?.num_rows)).filter((value) => value !== null);
  }

  if (Array.isArray(body?.size?.configs)) {
    return body.size.configs.flatMap((config) => (
      Array.isArray(config?.splits)
        ? config.splits.map((split) => getNumber(split?.num_rows)).filter((value) => value !== null)
        : []
    ));
  }

  return [];
}

function getDatasetLicense(metadata, fallback) {
  const cardLicense = typeof metadata?.cardData?.license === "string" ? metadata.cardData.license.toLowerCase() : "";
  const tagLicense = getTagValue(metadata?.tags, "license");
  return (cardLicense || tagLicense || fallback || "").toLowerCase();
}

function getTagValue(tags, prefix) {
  return getTagValues(tags, prefix)[0] ?? "";
}

function getTagValues(tags, prefix) {
  return Array.isArray(tags)
    ? tags
        .filter((tag) => typeof tag === "string" && tag.startsWith(`${prefix}:`))
        .map((tag) => tag.slice(prefix.length + 1))
        .filter(Boolean)
    : [];
}

async function writeLabelIndexes(outDir, records) {
  const byLabel = new Map();
  for (const record of records) {
    for (const label of record.labels) {
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
      count: items.length,
      kind,
      label,
      records: items.map((item) => item.id),
    });
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeJsonl(path, rows) {
  await writeFile(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

function stableId(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return `hf_${(hash >>> 0).toString(36)}`;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    || "unknown";
}

function getNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  buildHfAutomotiveSources()
    .then((result) => {
      console.log(JSON.stringify({
        outputDir: DEFAULT_OUT_DIR,
        recordCount: result.records.length,
        skipped: result.manifest.skipped.length,
      }, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
