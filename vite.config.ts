import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => ({
  plugins: [react()],
  // Tauri drives the dev server: fixed port, no screen clearing, ignore the Rust tree.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  test: {
    // LOOP.md section 1: the PC is shared with live agents; never more than two workers.
    maxWorkers: 2,
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
}));
