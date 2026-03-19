import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and set it.");
}

/**
 * Schema is additive-only: never remove tables or columns from shared/db-schema.ts
 * to avoid data loss. Run db:backup-data before db:push when in doubt.
 *
 * schemaFilter: only push/pull the "gapmc" schema. Tables in public (or other schemas)
 * are never touched — no drops of edit_history, applications, users, etc.
 */
export default defineConfig({
  out: "./migrations",
  schema: "./shared/db-schema.ts",
  dialect: "postgresql",
  schemaFilter: "gapmc",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
