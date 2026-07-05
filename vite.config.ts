import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { defineConfig, Plugin } from "vite";

// When a local Pretext clone exists at pretext/, resolve the package specifier
// to its sources (rewriting Pretext's runtime-honest ".js" imports to their
// ".ts" files) so changes there need no build step. Without the clone — fresh
// checkouts, CI — the npm package resolves normally. OUTLAY_PRETEXT=npm forces
// the npm package despite a local clone.
function pretextFromSource(): Plugin {
  const root = resolve(__dirname, "pretext/src");
  const useLocal = existsSync(root) && process.env.OUTLAY_PRETEXT !== "npm";
  return {
    name: "pretext-from-source",
    enforce: "pre",
    resolveId(source, importer) {
      if (!useLocal) return null;
      if (source === "@chenglou/pretext") return resolve(root, "layout.ts");
      if (
        importer &&
        importer.startsWith(root) &&
        source.startsWith(".") &&
        source.endsWith(".js")
      ) {
        return resolve(dirname(importer), source.replace(/\.js$/, ".ts"));
      }
      return null;
    },
  };
}

export default defineConfig({
  root: "pages",
  plugins: [pretextFromSource()],
  resolve: {
    alias: {
      outlay: resolve(__dirname, "src/index.ts"),
    },
  },
  build: {
    outDir: resolve(__dirname, "site"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "pages/index.html"),
        demos: resolve(__dirname, "pages/demos/index.html"),
        explorer: resolve(__dirname, "pages/demos/explorer.html"),
        transitions: resolve(__dirname, "pages/demos/transitions.html"),
        "drag-reorder": resolve(__dirname, "pages/demos/drag-reorder.html"),
        "virtual-scroll": resolve(__dirname, "pages/demos/virtual-scroll.html"),
        "text-layout": resolve(__dirname, "pages/demos/text-layout.html"),
        dashboard: resolve(__dirname, "pages/demos/dashboard.html"),
      },
    },
  },
});
