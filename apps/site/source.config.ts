import { defineConfig, defineDocs } from "fumadocs-mdx/config";

export const docs = defineDocs({
  dir: "../../packages/docs-content",
  docs: {
    files: ["**/*.mdx"],
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    files: ["**/meta.json"],
  },
});

export default defineConfig();
