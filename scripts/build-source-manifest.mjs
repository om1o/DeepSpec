import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const OUTPUT_PATH = "datasets/derived/source-manifest.json";
const HF_DATASET_ID = "DrBimmer/car-parts-and-damage-dataset";
const DATASET_SERVER = "https://datasets-server.huggingface.co";

async function main() {
  const generatedAt = new Date().toISOString();
  const [validity, splits, parquet, size] = await Promise.all([
    fetchJson(`${DATASET_SERVER}/is-valid?dataset=${encodeURIComponent(HF_DATASET_ID)}`),
    fetchJson(`${DATASET_SERVER}/splits?dataset=${encodeURIComponent(HF_DATASET_ID)}`),
    fetchJson(`${DATASET_SERVER}/parquet?dataset=${encodeURIComponent(HF_DATASET_ID)}`),
    fetchJson(`${DATASET_SERVER}/size?dataset=${encodeURIComponent(HF_DATASET_ID)}`),
  ]);

  const manifest = {
    generatedAt,
    policy: "docs/VERIFIED_SOURCE_POLICY.md",
    sources: [
      {
        id: "hf-drbimmer-car-parts-and-damage",
        name: "DrBimmer car parts and damage dataset",
        type: "huggingface_dataset",
        url: `https://huggingface.co/datasets/${HF_DATASET_ID}`,
        datasetId: HF_DATASET_ID,
        intendedUse: ["evaluation", "label-taxonomy-review", "failure-mode-analysis"],
        notFor: ["exact-fitment-claims", "oem-part-number-verification"],
        licenseNote: "Read the Hugging Face dataset card before training or redistribution; use eval outputs as product-quality evidence, not fitment proof.",
        availability: validity,
        splits: Array.isArray(splits?.splits) ? splits.splits : [],
        parquetFiles: Array.isArray(parquet?.parquet_files) ? parquet.parquet_files : [],
        size,
      },
      {
        id: "nhtsa-vpic",
        name: "NHTSA vPIC API",
        type: "government_vehicle_reference",
        url: "https://vpic.nhtsa.dot.gov/api/",
        intendedUse: ["vehicle-context-verification", "make-model-reference"],
        notFor: ["visual-part-identification"],
        licenseNote: "Public U.S. government API; vehicle fields are manufacturer-reported.",
      },
    ],
  };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Saved source manifest to ${OUTPUT_PATH}`);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    return {
      error: `HTTP ${response.status}`,
      url,
    };
  }

  return response.json();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
