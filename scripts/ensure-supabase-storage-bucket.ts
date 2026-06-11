/**
 * Create the Supabase Storage bucket if it does not exist (private bucket).
 *
 *   dotenv -e .env -- tsx scripts/ensure-supabase-storage-bucket.ts
 */
import "dotenv/config";
import { getConfiguredObjectStorageDriver } from "../server/object-storage";
import { assertSharedSupabaseStorageConfig, getSupabaseAdmin, getSupabaseStorageBucket } from "../server/supabase-admin";

async function main(): Promise<void> {
  if (getConfiguredObjectStorageDriver() !== "supabase") {
    console.error("Set OBJECT_STORAGE_DRIVER=supabase before running this script.");
    process.exit(1);
  }
  assertSharedSupabaseStorageConfig();

  const bucket = getSupabaseStorageBucket();
  const admin = getSupabaseAdmin();
  const { data: buckets, error: listErr } = await admin.storage.listBuckets();
  if (listErr) {
    throw new Error(`listBuckets failed: ${listErr.message}`);
  }
  if (buckets?.some((b) => b.name === bucket)) {
    console.log(`Bucket "${bucket}" already exists.`);
    return;
  }

  const { error } = await admin.storage.createBucket(bucket, { public: false });
  if (error) {
    throw new Error(`createBucket failed: ${error.message}`);
  }
  console.log(`Created private bucket "${bucket}".`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
