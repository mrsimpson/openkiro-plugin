import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: {
      external: [
        /^@aws\//,
        /^@ai-sdk\//,
        /^@opencode\//,
        /^bun:/,
        /^node:/,
        /^fs$/,
        /^path$/,
        /^os$/,
        /^crypto$/,
        /^child_process$/,
      ],
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    alias: {
      "bun:sqlite": new URL("src/test-support/bun-sqlite-mock.ts", import.meta.url).pathname,
    },
  },
  staged: {
    "*.{ts,js}": "vp check --fix",
  },
});
