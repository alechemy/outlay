import { resolve } from "path";
import { defineConfig } from "vite";

export default defineConfig({
  root: "pages",
  resolve: {
    alias: {
      "constraint-layout-algo": resolve(__dirname, "src/index.ts"),
    },
  },
});
