import { configureSameOriginOnnxRuntime } from "./browserTransformers";

describe("configureSameOriginOnnxRuntime", () => {
  it("removes the remote ONNX runtime override before a browser pipeline starts", () => {
    const wasm = {
      wasmPaths: {
        mjs: "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/runtime.mjs",
        wasm: "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/runtime.wasm",
      },
    };

    configureSameOriginOnnxRuntime({ env: { backends: { onnx: { wasm } } } });

    expect(wasm.wasmPaths).toEqual({ wasm: expect.stringContaining("ort-wasm-simd-threaded.asyncify.wasm") });
    expect(wasm.wasmPaths.wasm).not.toContain("cdn.jsdelivr.net");
  });

  it("is a no-op for a mocked module without an ONNX environment", () => {
    expect(() => configureSameOriginOnnxRuntime({})).not.toThrow();
  });
});
