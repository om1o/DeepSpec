type BrowserTransformersModule = {
  env?: {
    backends?: {
      onnx?: {
        wasm?: {
          wasmPaths?: unknown;
        };
      };
    };
  };
};

export function configureSameOriginOnnxRuntime(transformers: BrowserTransformersModule) {
  if (!("env" in transformers)) return;
  const wasm = transformers.env?.backends?.onnx?.wasm;
  if (wasm) {
    // Pin the installed WebGPU runtime binary as a Vite asset. Clearing the CDN
    // override alone leaves the dev optimizer looking beside its generated chunk.
    // Keep the bundled JS factory; only override the matching Asyncify binary.
    wasm.wasmPaths = { wasm: new URL(onnxWasmUrl, import.meta.url).href };
  }
}
import onnxWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
