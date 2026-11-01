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
    // Transformers.js replaces the bundled Vite asset with jsDelivr by default.
    // Clearing that override restores ONNX Runtime's emitted same-origin WASM URL.
    wasm.wasmPaths = undefined;
  }
}
