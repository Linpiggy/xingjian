import { defineConfig } from "drizzle-kit";

// Generation only: no credentials, automatic connection, push or migration.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
});
