import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The worked example's subject, so tests run offline and deterministically without a .env.
    env: {
      SUBJECT_NAME: "Jean Loureiro",
      SUBJECT_SHORT_NAME: "Jean",
      LINKEDIN_PROFILE: "https://au.linkedin.com/in/jeanloureiro",
      GITHUB_USERNAME: "JeanLoureiro",
    },
  },
});
