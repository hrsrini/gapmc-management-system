/**
 * One-time migration: upload files from local `uploads/` into Supabase Storage.
 * Requires OBJECT_STORAGE_DRIVER=supabase, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET.
 *
 *   dotenv -e .env -- tsx scripts/migrate-local-uploads-to-supabase.ts
 *   dotenv -e .env -- tsx scripts/migrate-local-uploads-to-supabase.ts --dry-run
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import {
  getConfiguredObjectStorageDriver,
  getUploadBlobStore,
  resolveLocalUploadsRoot,
} from "../server/object-storage";

const dryRun = process.argv.includes("--dry-run");

function walkFiles(dir: string, base: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      walkFiles(abs, base, out);
    } else if (st.isFile()) {
      const rel = path.relative(base, abs).replace(/\\/g, "/");
      out.push(rel);
    }
  }
}

async function main(): Promise<void> {
  if (getConfiguredObjectStorageDriver() !== "supabase") {
    console.error("Set OBJECT_STORAGE_DRIVER=supabase before running this migration.");
    process.exit(1);
  }

  const root = resolveLocalUploadsRoot();
  const keys: string[] = [];
  walkFiles(root, root, keys);

  if (keys.length === 0) {
    console.log(`No files under ${root} — nothing to migrate.`);
    return;
  }

  console.log(`Found ${keys.length} file(s) under ${root}${dryRun ? " (dry run)" : ""}.`);
  const store = getUploadBlobStore();
  let uploaded = 0;
  let skipped = 0;

  for (const key of keys.sort()) {
    if (await store.exists(key)) {
      skipped += 1;
      console.log(`skip (exists): ${key}`);
      continue;
    }
    if (dryRun) {
      console.log(`would upload: ${key}`);
      uploaded += 1;
      continue;
    }
    const buf = fs.readFileSync(path.join(root, key));
    const ext = path.extname(key).toLowerCase();
    const contentType =
      ext === ".pdf"
        ? "application/pdf"
        : ext === ".png"
          ? "image/png"
          : ext === ".jpg" || ext === ".jpeg"
            ? "image/jpeg"
            : "application/octet-stream";
    await store.put(key, buf, contentType);
    uploaded += 1;
    console.log(`uploaded: ${key}`);
  }

  console.log(`Done. uploaded=${uploaded} skipped=${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
