/**
 * Smoke test: put → exists → get → delete on configured UploadBlobStore.
 *   npm run storage:smoke
 */
import "dotenv/config";
import { getConfiguredObjectStorageDriver, getUploadBlobStore } from "../server/object-storage";
import {
  assertSharedSupabaseStorageConfig,
  getSupabaseStorageBucket,
  getSupabaseStoragePrefix,
} from "../server/supabase-admin";

async function main(): Promise<void> {
  assertSharedSupabaseStorageConfig();
  const testKey = `_smoke-test/upload-${Date.now()}.txt`;
  const payload = Buffer.from(`GAPLMC storage smoke test ${new Date().toISOString()}`, "utf8");

  console.log("Driver:", getConfiguredObjectStorageDriver());
  console.log("Bucket:", getSupabaseStorageBucket());
  console.log("Prefix:", getSupabaseStoragePrefix());
  console.log("Blob key:", testKey);

  const store = getUploadBlobStore();
  await store.put(testKey, payload, "text/plain");

  const exists = await store.exists(testKey);
  const downloaded = await store.get(testKey);
  const match = downloaded != null && downloaded.equals(payload);

  await store.del(testKey);
  const gone = !(await store.exists(testKey));

  if (!exists || !match || !gone) {
    console.error("FAILED", { exists, match, gone });
    process.exit(1);
  }

  console.log("SUCCESS: upload, download, and delete verified.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
