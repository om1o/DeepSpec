import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildVerifiedVehicleReference } from "./build-verified-vehicle-reference.mjs";

describe("buildVerifiedVehicleReference", () => {
  it("downloads, filters, labels, and sorts verified Toyota Camry references", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepspec-verified-reference-"));
    const requestedUrls = [];
    try {
      const result = await buildVerifiedVehicleReference({
        fetcher: async (url) => {
          requestedUrls.push(url);
          const year = Number(new URL(url).pathname.match(/modelyear\/(\d{4})/)?.[1]);
          return {
            ok: true,
            json: async () => ({
              Results: [
                { Make_ID: 448, Make_Name: "TOYOTA", Model_ID: 2469, Model_Name: "Camry" },
                { Make_ID: 448, Make_Name: "TOYOTA", Model_ID: 2208, Model_Name: "Corolla" },
                ...(year === 2021 ? [{ Make_ID: 448, Make_Name: "TOYOTA", Model_ID: 2213, Model_Name: "Highlander" }] : []),
              ],
            }),
          };
        },
        generatedAt: "2026-06-03T00:00:00.000Z",
        outDir: root,
        years: "2020-2021",
      });

      expect(requestedUrls).toHaveLength(2);
      expect(result.manifest).toMatchObject({
        datasetId: "verified-vehicle-reference-v1",
        recordCount: 5,
        target: {
          make: "toyota",
          model: "camry",
          years: [2020, 2021],
        },
      });

      const records = (await readFile(join(root, "records.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));

      expect(records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            canonicalKind: "vehicle_model_year",
            labels: expect.arrayContaining(["toyota", "camry", "2020", "vehicle_identity"]),
            primaryLabel: "Toyota Camry 2020",
            sourceName: "NHTSA vPIC API",
            sourceTier: "tier_1_government",
            trainingAllowed: false,
            verificationStatus: "constrained",
          }),
          expect.objectContaining({
            canonicalKind: "verified_source_pointer",
            downloaded: false,
            primaryLabel: "Toyota Technical Information System",
            sourceTier: "tier_1_oem",
            trainingAllowed: false,
            verificationStatus: "verified",
          }),
        ]),
      );

      const camryIndex = JSON.parse(await readFile(join(root, "by-label", "camry", "records.json"), "utf8"));
      expect(camryIndex).toMatchObject({
        count: 5,
        label: "camry",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("records skipped years instead of inventing missing model data", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepspec-verified-reference-missing-"));
    try {
      const result = await buildVerifiedVehicleReference({
        fetcher: async () => ({
          ok: true,
          json: async () => ({ Results: [{ Make_ID: 448, Make_Name: "TOYOTA", Model_ID: 2208, Model_Name: "Corolla" }] }),
        }),
        outDir: root,
        years: "2020",
      });

      expect(result.manifest.skipped).toEqual([
        {
          make: "toyota",
          model: "camry",
          modelYear: 2020,
          reason: "No exact NHTSA model match.",
        },
      ]);
      expect(result.records.some((record) => record.canonicalKind === "vehicle_model_year")).toBe(false);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
