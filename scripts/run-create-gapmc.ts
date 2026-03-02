/**
 * Runs scripts/create-gapmc-schema.sql against DATABASE_URL from .env.
 * Only creates the gapmc schema and tables; does not drop or alter any existing tables.
 */
import "dotenv/config";
import { Pool } from "pg";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Add it to .env");
  process.exit(1);
}

const sqlPath = path.join(__dirname, "create-gapmc-schema.sql");
const sql = readFileSync(sqlPath, "utf-8");

const pool = new Pool({ connectionString });
try {
  await pool.query(sql);
  console.log("gapmc schema and tables created successfully.");
} catch (err) {
  console.error("Error creating gapmc schema:", err);
  process.exit(1);
} finally {
  await pool.end();
}
