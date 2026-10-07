import { defineConfig } from "drizzle-kit";

/** Only used by `drizzle-kit generate` to write SQL migrations; the app never loads drizzle-kit. */
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
});
