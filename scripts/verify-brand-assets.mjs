import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Lossless WebP exports cover the largest CSS dimensions at 3x DPR.
export const BRAND_ASSETS = [
  { name: "deepspec-symbol.webp", width: 168, maxBytes: 12000 },
  { name: "deepspec-scan-badge-glass.webp", width: 336, maxBytes: 45000 },
];

export function verifyBrandImage(bytes, asset) {
  if (bytes.length > asset.maxBytes) throw new Error(`${asset.name}: exceeds ${asset.maxBytes} byte budget`);
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") {
    throw new Error(`${asset.name}: expected WebP`);
  }
  // VP8L packs width, height and alpha into the 32 bits after its signature.
  let header;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4);
    if (bytes.toString("ascii", offset, offset + 4) === "VP8L" && size >= 5 && offset + 13 <= bytes.length && bytes[offset + 8] === 0x2f) {
      header = bytes.readUInt32LE(offset + 9);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (header === undefined) throw new Error(`${asset.name}: expected lossless VP8L`);
  const width = (header & 0x3fff) + 1;
  const height = ((header >>> 14) & 0x3fff) + 1;
  if (width !== asset.width || height !== asset.width || !(header & 0x10000000)) {
    throw new Error(`${asset.name}: expected ${asset.width}x${asset.width} with alpha`);
  }
}

export async function verifyBrandAssets(distDir = "dist") {
  for (const asset of BRAND_ASSETS) {
    verifyBrandImage(await readFile(path.join(distDir, "brand", asset.name)), asset);
  }
  const bundleFiles = (await readdir(path.join(distDir, "assets"))).filter((name) => name.endsWith(".js"));
  const bundle = (await Promise.all(bundleFiles.map((name) => readFile(path.join(distDir, "assets", name), "utf8")))).join("\n");
  for (const asset of BRAND_ASSETS) {
    if (!bundle.includes(`/brand/${asset.name}`)) throw new Error(`Missing runtime reference: ${asset.name}`);
    const original = asset.name.replace(".webp", ".png");
    if (bundle.includes(`/brand/${original}`)) throw new Error(`Oversized runtime reference: ${original}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  verifyBrandAssets(process.argv[2]).then(() => console.log("Brand assets: lossless alpha, 3x dimensions, byte budgets and bundle references passed.")).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
