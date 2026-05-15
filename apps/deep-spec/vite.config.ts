import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.DEEP_SPEC_API_PROXY ?? "http://127.0.0.1:8788";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
    },
  },
  preview: {
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
    },
  },
});
