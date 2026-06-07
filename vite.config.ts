import { defineConfig } from "vite";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
  staged: {
    "*.{ts,js}": "vp check --fix",
  },
});
