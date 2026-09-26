import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildHfAutomotiveSources } from "./build-hf-automotive-sources.mjs";

describe("buildHfAutomotiveSources", () => {
  it("downloads HF source metadata and writes license-safe catalog records", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepspec-hf-sources-"));
    const requestedUrls = [];

    try {
      const result = await buildHfAutomotiveSources({
        fetcher: async (url) => {
          requestedUrls.push(url);
          const parsed = new URL(url);
          if (parsed.hostname === "huggingface.co") {
            const datasetId = decodeURIComponent(parsed.pathname.replace(/^\/api\/datasets\//, ""));
            return jsonResponse({
              downloads: datasetId.includes("allowed") ? 42 : 3,
              tags: datasetId.includes("blocked")
                ? ["license:unknown"]
                : ["license:mit", "task_categories:object-detection", "size_categories:n<1K"],
            });
          }

          return jsonResponse({
            size: {
              splits: [{ num_rows: 12 }, { num_rows: 8 }],
            },
          });
        },
        generatedAt: "2026-06-24T00:00:00.000Z",
        outDir: root,
        sources: [
          {
            datasetId: "example/allowed-car-damage",
            labelGroups: {
              damage: ["dent"],
              part: ["front bumper"],
            },
          },
          {
            datasetId: "example/blocked-car-damage",
            labelGroups: {
              damage: ["scratch"],
            },
          },
        ],
      });

      expect(requestedUrls.some((url) => String(url).includes("huggingface.co/api/datasets"))).toBe(true);
      expect(requestedUrls.some((url) => String(url).includes("datasets-server.huggingface.co/size"))).toBe(true);
      expect(result.records).toHaveLength(2);
      expect(result.manifest.skipped).toEqual([
        expect.objectContaining({
          datasetId: "example/blocked-car-damage",
          license: "unknown",
        }),
      ]);

      const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
      expect(manifest).toMatchObject({
        datasetId: "hf-automotive-sources-v1",
        recordCount: 2,
      });

      const records = (await readFile(join(root, "records.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            canonicalKind: "damage",
            datasetId: "example/allowed-car-damage",
            labels: ["dent"],
            license: "mit",
            sampleCount: 20,
          }),
          expect.objectContaining({
            canonicalKind: "part",
            labels: ["front bumper"],
            links: {
              dataset: "https://huggingface.co/datasets/example/allowed-car-damage",
            },
          }),
        ]),
      );

      const index = JSON.parse(await readFile(join(root, "by-label", "part", "front-bumper", "records.json"), "utf8"));
      expect(index).toMatchObject({
        count: 1,
        kind: "part",
        label: "front bumper",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

function jsonResponse(body) {
  return {
    ok: true,
    json: async () => body,
  };
}
