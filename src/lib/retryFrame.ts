import type { CapturedFrame } from "../types";
import { compressImageDataUrl } from "./utils";

const MAX_RECOVERED_DATA_URL_LENGTH = 750_000;

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
    const imageBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(unavailable));
      reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error(unavailable));
      reader.readAsDataURL(blob);
    });
    const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(imageBase64);
    const bytes = match ? atob(match[2]) : "";
    const valid = match?.[1] === "jpeg" ? bytes.startsWith("\xff\xd8\xff")
      : match?.[1] === "png" ? bytes.startsWith("\x89PNG\r\n\x1a\n")
        : match?.[1] === "webp" && bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP";
    if (!valid) throw new Error("The saved photo is not a valid JPEG, PNG, or WebP image.");
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
