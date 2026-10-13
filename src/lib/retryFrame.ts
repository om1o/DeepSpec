import type { CapturedFrame } from "../types";
import { compressImageDataUrl } from "./utils";

const MAX_RECOVERED_DATA_URL_LENGTH = 750_000;
const BASE64_CHUNK_SIZE = 32_768;

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE));
  }
  return btoa(binary);
}

// Signed cloud-history images must be materialized before the data-URL-only API call.
export async function prepareRetryFrame(
  frame: CapturedFrame,
  compressImage = compressImageDataUrl,
): Promise<CapturedFrame> {
  if (frame.imageBase64.startsWith("data:")) return frame;
  const unavailable = "The saved photo could not be loaded. Reopen it from saved scans to refresh its link, or take a new photo.";
  if (!frame.imageBase64.startsWith("https://")) throw new Error(unavailable);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(frame.imageBase64, { signal: controller.signal, credentials: "omit" });
    if (!response.ok) throw new Error(unavailable);
    const blob = await response.blob();
    if (!/^image\/(jpeg|png|webp)$/.test(blob.type) || !blob.size || blob.size > 10_000_000) {
      throw new Error("The saved photo must be a JPEG, PNG, or WebP image smaller than 10 MB.");
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const valid = blob.type === "image/jpeg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : blob.type === "image/png" ? bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)
        : bytes.length >= 12
          && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF"
          && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
    if (!valid) throw new Error("The saved photo is not a valid JPEG, PNG, or WebP image.");
    const imageBase64 = `data:${blob.type};base64,${bytesToBase64(bytes)}`;
    const boundedImage = imageBase64.length > MAX_RECOVERED_DATA_URL_LENGTH
      ? await compressImage(imageBase64, 1024, 0.76)
      : imageBase64;
    return { ...frame, imageBase64: boundedImage };
  } catch (error) {
    if (error instanceof TypeError || controller.signal.aborted) throw new Error(unavailable, { cause: error });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
