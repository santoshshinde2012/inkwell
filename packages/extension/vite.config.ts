import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import path from "node:path";
import { buildManifest } from "./manifest.config";

export default defineConfig(({ mode }) => {
  // loadEnv reads .env, .env.local, .env.[mode], .env.[mode].local from the
  // extension package dir, AND merges in matching shell env vars. So both
  //   packages/extension/.env.local   (VITE_BACKEND_URL=...)
  // and
  //   VITE_BACKEND_URL=... pnpm --filter @inkwell/extension build
  // work. Falls back to the local backend.
  const env = loadEnv(mode, __dirname, "VITE_");
  const backendUrl = env.VITE_BACKEND_URL || "http://localhost:3000";

  return {
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    // Build-time globals (see src/types.d.ts for their declarations).
    define: {
      __BACKEND_URL__: JSON.stringify(backendUrl),
      __DEV__: JSON.stringify(mode !== "production"),
    },
    plugins: [react(), crx({ manifest: buildManifest(backendUrl) })],
    build: {
      target: "esnext",
      sourcemap: mode !== "production" ? "inline" : false,
      minify: mode === "production",
      emptyOutDir: true,
    },
    server: {
      port: 5173,
      strictPort: true,
      hmr: {
        port: 5173,
      },
    },
  };
});
