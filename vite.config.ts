import { dirname, resolve } from "path";
import { defineConfig, Plugin } from "vite";

// Resolve the vendored Pretext tree from source: map the package specifier to
// its entry and rewrite Pretext's runtime-honest ".js" imports to their ".ts"
// sources so the demo needs no separate build step.
function pretextFromSource(): Plugin {
  const root = resolve(__dirname, "pretext/src");
  return {
    name: "pretext-from-source",
    enforce: "pre",
    resolveId(source, importer) {
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
      "constraint-layout-algo": resolve(__dirname, "src/index.ts"),
    },
  },
});
