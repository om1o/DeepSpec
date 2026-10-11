import { describe, expect, it, vi } from "vitest";
import { prepareRetryFrame } from "./retryFrame";

describe("prepareRetryFrame", () => {
  it("compresses a large recovered cloud image before returning it for persistence", async () => {
    const jpeg = new Uint8Array(800_000);
    jpeg.set([0xff, 0xd8, 0xff]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(jpeg, {
      status: 200,
      headers: { "Content-Type": "image/jpeg" },
    })));
    const compress = vi.fn(async () => "data:image/jpeg;base64,bounded");

    await expect(prepareRetryFrame({
      capturedAt: "2026-10-10T00:00:00.000Z",
      imageBase64: "https://example.test/signed-photo.jpg",
    }, compress)).resolves.toMatchObject({ imageBase64: "data:image/jpeg;base64,bounded" });

    expect(compress).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/jpeg;base64,/), 1024, 0.76);
  });

  it("does not recompress a small recovered cloud image", async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(jpeg, {
      status: 200,
      headers: { "Content-Type": "image/jpeg" },
    })));
    const compress = vi.fn(async () => "data:image/jpeg;base64,bounded");

    const result = await prepareRetryFrame({
      capturedAt: "2026-10-10T00:00:00.000Z",
      imageBase64: "https://example.test/signed-photo.jpg",
    }, compress);

    expect(result.imageBase64).toMatch(/^data:image\/jpeg;base64,/);
    expect(compress).not.toHaveBeenCalled();
  });
});
