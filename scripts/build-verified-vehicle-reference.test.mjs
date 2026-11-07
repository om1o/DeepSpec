import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildVerifiedVehicleReference } from "./build-verified-vehicle-reference.mjs";

async function removeTempRoot(root) {
  const target = resolve(root);
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("deepspec-verified-reference-")) throw new Error("Unsafe test cleanup path");
  await rm(target, { force: true, recursive: true });
}

async function withReferenceBuild(options, check) {
  const root = await mkdtemp(join(tmpdir(), "deepspec-verified-reference-applicability-"));
  try {
    return await check(() => buildVerifiedVehicleReference({ years: "2020", generatedAt: "2026-11-07T00:00:00.000Z", ...options, outDir: root }));
  } finally { await removeTempRoot(root); }
}

describe("buildVerifiedVehicleReference", () => {
  it("never attaches Toyota portals to a Honda request or invents a Toyota Accord", async () => {
    await withReferenceBuild({ make: "Honda", model: "Accord", fetcher: async () => ({ ok: true, json: async () => ({ Results: [{ Make_ID: 474, Make_Name: "HONDA", Model_ID: 1861, Model_Name: "Accord" }] }) }) }, async build => {
      const { records, manifest } = await build();
      expect(records.filter(record => record.canonicalKind === "vehicle_model_year")).toHaveLength(1);
      expect(JSON.stringify({ records, manifest }).toLowerCase()).not.toContain("toyota");
      const pointers = records.filter(record => record.canonicalKind === "source_pointer");
      expect(pointers).toHaveLength(1);
      expect(pointers[0]).toMatchObject({ sourceVehicle: { make: null, model: null, modelYear: null } });
    });
  });

  it("keeps Toyota portals manufacturer-scoped without claiming that they verified a selected model", async () => {
    await withReferenceBuild({ make: "Toyota", model: "Corolla", fetcher: async () => ({ ok: true, json: async () => ({ Results: [{ Make_ID: 448, Make_Name: "TOYOTA", Model_ID: 2208, Model_Name: "Corolla" }] }) }) }, async build => {
      const { records } = await build();
      expect(JSON.stringify(records).toLowerCase()).not.toContain("camry");
      const pointers = records.filter(record => record.sourceTier === "tier_1_oem");
      expect(pointers).toHaveLength(3);
      for (const pointer of pointers) {
        expect(pointer.sourceVehicle).toEqual({ make: "Toyota", model: null, modelYear: null });
        expect(pointer.labels).not.toContain("corolla");
        expect(pointer.verificationStatus).toBe("unverified");
      }
    });
  });

  it("does not accept an exact model name returned under the wrong make", async () => {
    await withReferenceBuild({ make: "Honda", model: "Accord", fetcher: async () => ({ ok: true, json: async () => ({ Results: [{ Make_ID: 448, Make_Name: "TOYOTA", Model_ID: 1861, Model_Name: "Accord" }] }) }) }, async build => {
      const { records, manifest } = await build();
      expect(records.some(record => record.canonicalKind === "vehicle_model_year")).toBe(false);
      expect(manifest.skipped).toEqual([{ make: "honda", model: "accord", modelYear: 2020, reason: "No exact NHTSA make/model match." }]);
    });
  });

  it.each([null, {}, { Results: {} }])("reports malformed upstream data instead of silently calling it an empty result: %j", async payload => {
    await withReferenceBuild({ fetcher: async () => ({ ok: true, json: async () => payload }) }, async build => {
      await expect(build()).rejects.toThrow("Invalid NHTSA response");
    });
  });

  it("does not invent a retrieval time or verified content for a portal it never fetched", async () => {
    const requested = [];
    await withReferenceBuild({ fetcher: async url => { requested.push(url); return { ok: true, json: async () => ({ Results: [] }) }; } }, async build => {
      const { records } = await build();
      expect(requested).toHaveLength(1);
      for (const pointer of records) {
        expect(pointer).toMatchObject({ canonicalKind: "source_pointer", downloaded: false, verificationStatus: "unverified", sourceRetrievedAt: null, metadataGeneratedAt: "2026-11-07T00:00:00.000Z" });
        expect(pointer.retrievalUse).toEqual(["source_lookup", "manual_review"]);
        expect(requested).not.toContain(pointer.sourceUrl);
      }
    });
  });

  it("builds constrained Toyota Camry records and unfetched source pointers", async () => {
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
        recordCount: 6,
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
            canonicalKind: "source_pointer",
            downloaded: false,
            primaryLabel: "Toyota Technical Information System",
            sourceTier: "tier_1_oem",
            trainingAllowed: false,
            verificationStatus: "unverified",
          }),
        ]),
      );

      const camryIndex = JSON.parse(await readFile(join(root, "by-label", "camry", "records.json"), "utf8"));
      expect(camryIndex).toMatchObject({
        count: 2,
        label: "camry",
      });
    } finally {
      await removeTempRoot(root);
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
          reason: "No exact NHTSA make/model match.",
        },
      ]);
      expect(result.records.some((record) => record.canonicalKind === "vehicle_model_year")).toBe(false);
    } finally {
      await removeTempRoot(root);
    }
  });
});
