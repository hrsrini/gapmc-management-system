/**
 * Single Supabase Storage target for local, dev, and production.
 * Do not use per-environment buckets or prefixes — one shared bucket keeps
 * uploads visible across environments (same as the shared Postgres project).
 */
export const STANDARD_OBJECT_STORAGE_DRIVER = "supabase" as const;

/** Private bucket name (create once: npm run storage:ensure-bucket). */
export const STANDARD_SUPABASE_STORAGE_BUCKET = "gapmc-uploads";

/** Object key prefix inside the bucket for all app uploads. */
export const STANDARD_SUPABASE_STORAGE_PREFIX = "storage";

export interface SupabaseStorageStandardSummary {
  driver: typeof STANDARD_OBJECT_STORAGE_DRIVER;
  bucket: string;
  prefix: string;
}

export function supabaseStorageStandardSummary(): SupabaseStorageStandardSummary {
  return {
    driver: STANDARD_OBJECT_STORAGE_DRIVER,
    bucket: STANDARD_SUPABASE_STORAGE_BUCKET,
    prefix: STANDARD_SUPABASE_STORAGE_PREFIX,
  };
}
