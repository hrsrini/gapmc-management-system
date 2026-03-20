import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@shared/db-schema";

const connectionString = process.env.DATABASE_URL!;

/** Shared pool — also used by express-session (connect-pg-simple) in production. */
export const pool = new Pool({ connectionString });

/**
 * Drizzle client for the gapmc schema. Only GAPMC tables (gapmc.*) are used;
 * existing tables in the database are never touched.
 */
export const db = drizzle(pool, { schema });
