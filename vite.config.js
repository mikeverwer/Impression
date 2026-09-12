import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig({
  // Tauri expects a fixed port; fail if that port is not available.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      // Don't let Vite's watcher churn on Rust build output.
      ignored: ["**/src-tauri/**"],
    },
  },
  // Env variables starting with TAURI_ENV_* are exposed to the frontend.
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    // WebView2 is evergreen Chromium; target a recent baseline.
    target: "chrome120",
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});

