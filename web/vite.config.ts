import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const backend = process.env.FLOODLINE_API ?? "http://127.0.0.1:8000";

/**
 * FastAPI serves dist/ with StaticFiles(html=True), which has no SPA fallback:
 * /report only works if dist/report/index.html exists. Copy the shell there (and
 * to 404.html as a catch-all). The client routes on window.location.pathname.
 */
function spaRoutes(routes: string[]): Plugin {
  let outDir = "dist";
  return {
    name: "floodline-spa-routes",
    apply: "build",
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const index = resolve(outDir, "index.html");
      for (const r of routes) {
        mkdirSync(resolve(outDir, r), { recursive: true });
        copyFileSync(index, resolve(outDir, r, "index.html"));
      }
      copyFileSync(index, resolve(outDir, "404.html"));
    },
  };
}

export default defineConfig({
  plugins: [react(), spaRoutes(["report", "attribution"])],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: backend, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
});
