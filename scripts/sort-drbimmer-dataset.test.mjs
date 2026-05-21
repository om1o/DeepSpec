import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sortDrBimmerDataset } from "./sort-drbimmer-dataset.mjs";

describe("sortDrBimmerDataset", () => {
  it("reports an incomplete raw download before sorting", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepspec-sort-incomplete-"));
    try {
      await mkdir(join(root, "raw", "Car damages dataset"), { recursive: true });

      const result = await sortDrBimmerDataset({
        linkMode: "none",
        outDir: join(root, "derived"),
        rawDir: join(root, "raw"),
      });

      expect(result.ok).toBe(false);
      expect(result.missing.some((path) => path.includes("Car parts dataset"))).toBe(true);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("creates a sorted manifest and label indexes from metadata and annotations", async () => {
    const root = await mkdtemp(join(tmpdir(), "deepspec-sort-complete-"));
    try {
      const rawDir = join(root, "raw");
      const outDir = join(root, "derived");
      await writeGroupFixture({
        labels: ["Front-bumper", "Fender"],
        rawDir,
        rawName: "Car damages dataset",
        title: "Front-bumper",
      });
      await writeGroupFixture({
        labels: ["Dent", "Scratch"],
        rawDir,
        rawName: "Car parts dataset",
        title: "Dent",
      });

      const result = await sortDrBimmerDataset({
        linkMode: "none",
        outDir,
        rawDir,
      });

      expect(result.ok).toBe(true);
      expect(result.manifest.totalRecords).toBe(2);
      expect(result.manifest.groups).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ canonicalKind: "part", labels: ["Fender", "Front-bumper"], recordCount: 1 }),
          expect.objectContaining({ canonicalKind: "damage", labels: ["Dent", "Scratch"], recordCount: 1 }),
        ]),
      );

      const records = (await readFile(join(outDir, "records.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ canonicalKind: "part", labels: ["Front-bumper"], primaryLabel: "Front-bumper" }),
          expect.objectContaining({ canonicalKind: "damage", labels: ["Dent"], primaryLabel: "Dent" }),
        ]),
      );

      const labelIndex = JSON.parse(await readFile(join(outDir, "by-label", "part", "front-bumper", "records.json"), "utf8"));
      expect(labelIndex).toMatchObject({ count: 1, kind: "part", label: "Front-bumper" });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

async function writeGroupFixture({ labels, rawDir, rawName, title }) {
  const groupDir = join(rawDir, rawName);
  await mkdir(join(groupDir, "File1", "ann"), { recursive: true });
  await mkdir(join(groupDir, "File1", "img"), { recursive: true });
  await mkdir(join(groupDir, "File1", "masks_machine"), { recursive: true });
  await writeFile(
    join(groupDir, "meta.json"),
    JSON.stringify({
      classes: labels.map((label) => ({ title: label })),
    }),
  );
  await writeFile(
    join(groupDir, "File1", "ann", "sample.png.json"),
    JSON.stringify({
      objects: [{ classTitle: title }],
    }),
  );
  await writeFile(join(groupDir, "File1", "img", "sample.png"), "");
  await writeFile(join(groupDir, "File1", "masks_machine", "sample.png"), "");
}
