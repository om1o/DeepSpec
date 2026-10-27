import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { BRAND_ASSETS, verifyBrandImage } from "./verify-brand-assets.mjs";

describe("mobile brand asset budgets", () => {
  for (const asset of BRAND_ASSETS) {
    it(`accepts ${asset.name} and rejects oversized or opaque replacements`, async () => {
      const bytes = await readFile(`public/brand/${asset.name}`);
      expect(() => verifyBrandImage(bytes, asset)).not.toThrow();
      expect(() => verifyBrandImage(Buffer.concat([bytes, Buffer.alloc(asset.maxBytes)]), asset)).toThrow(/budget/);
      expect(() => verifyBrandImage(bytes, { ...asset, width: 1254 })).toThrow(/expected/);
      const opaque = Buffer.from(bytes);
      opaque[24] &= 0xef;
      expect(() => verifyBrandImage(opaque, asset)).toThrow(/alpha/);
    });
  }
});
