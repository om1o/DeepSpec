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

    expect(wasm.wasmPaths).toBeUndefined();
  });

  it("is a no-op for a mocked module without an ONNX environment", () => {
    expect(() => configureSameOriginOnnxRuntime({})).not.toThrow();
  });
});
