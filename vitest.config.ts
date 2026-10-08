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
      // Forces the JSON snapshot, so a DATABASE_URL in the developer's shell never reaches tests.
      DATABASE_URL: "",
      // Tests never load the embedding model; hybrid ranking is tested with synthetic vectors.
      RETRIEVAL_MODE: "bm25",
    },
  },
});
