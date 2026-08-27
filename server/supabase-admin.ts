/**
 * Server-side Supabase client (service role) for Storage and other admin APIs.
 * Never expose SUPABASE_SERVICE_ROLE_KEY to the browser.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import {
  STANDARD_OBJECT_STORAGE_DRIVER,
  STANDARD_SUPABASE_STORAGE_BUCKET,
  STANDARD_SUPABASE_STORAGE_PREFIX,
} from "@shared/supabase-storage-standard";

let cached: SupabaseClient | null = null;

export {
  STANDARD_OBJECT_STORAGE_DRIVER,
  STANDARD_SUPABASE_STORAGE_BUCKET,
  STANDARD_SUPABASE_STORAGE_PREFIX,
} from "@shared/supabase-storage-standard";

/** @deprecated Use STANDARD_SUPABASE_STORAGE_PREFIX from @shared/supabase-storage-standard */
export const DEFAULT_SUPABASE_STORAGE_PREFIX = STANDARD_SUPABASE_STORAGE_PREFIX;

export function requireSupabaseUrl(): string {
  const url = (process.env.SUPABASE_URL ?? "").trim();
  if (!url) {
    throw new Error("SUPABASE_URL is required when OBJECT_STORAGE_DRIVER=supabase");
  }
  return url;
}

export function requireSupabaseServiceRoleKey(): string {
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required when OBJECT_STORAGE_DRIVER=supabase");
  }
  return key;
}

export function getSupabaseStorageBucket(): string {
  const bucket = (process.env.SUPABASE_STORAGE_BUCKET ?? STANDARD_SUPABASE_STORAGE_BUCKET).trim();
  if (!bucket) {
    throw new Error("SUPABASE_STORAGE_BUCKET must not be empty");
  }
  return bucket;
}

export function getSupabaseStoragePrefix(): string {
  const p = (process.env.SUPABASE_STORAGE_PREFIX ?? STANDARD_SUPABASE_STORAGE_PREFIX)
    .trim()
    .replace(/\\/g, "/");
  if (!p) return "";
  return p.endsWith("/") ? p.slice(0, -1) : p;
}

function supabaseProjectRefFromUrl(url: string): string | null {
  const m = url.trim().match(/^https:\/\/([^.]+)\.supabase\.co\/?$/i);
  return m?.[1] ?? null;
}

function supabaseProjectRefFromDatabaseUrl(databaseUrl: string): string | null {
  const m = databaseUrl.match(/@db\.([^.]+)\.supabase\.co/i);
  return m?.[1] ?? null;
}

/**
 * Fail fast when env points at a different bucket/prefix or Supabase project than the shared standard.
 * Local, dev, and production must use the same Storage bucket (same Supabase project as DATABASE_URL).
 */
export function assertSharedSupabaseStorageConfig(): void {
  const bucket = getSupabaseStorageBucket();
  const prefix = getSupabaseStoragePrefix();
  if (bucket !== STANDARD_SUPABASE_STORAGE_BUCKET) {
    throw new Error(
      `SUPABASE_STORAGE_BUCKET must be "${STANDARD_SUPABASE_STORAGE_BUCKET}" for all environments (got "${bucket}").`,
    );
  }
  if (prefix !== STANDARD_SUPABASE_STORAGE_PREFIX) {
    throw new Error(
      `SUPABASE_STORAGE_PREFIX must be "${STANDARD_SUPABASE_STORAGE_PREFIX}" for all environments (got "${prefix}").`,
    );
  }

  const storageUrl = requireSupabaseUrl();
  const dbUrl = (process.env.DATABASE_URL ?? "").trim();
  const storageRef = supabaseProjectRefFromUrl(storageUrl);
  const dbRef = supabaseProjectRefFromDatabaseUrl(dbUrl);
  if (storageRef && dbRef && storageRef !== dbRef) {
    throw new Error(
      `SUPABASE_URL project (${storageRef}) must match DATABASE_URL Supabase project (${dbRef}).`,
    );
  }
}

/** Safe one-line log for ops (no secrets). Call after {@link ensureSupabaseStorageConfigReady}. */
export function formatSupabaseStorageStartupLine(): string {
  const url = requireSupabaseUrl();
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    /* keep raw */
  }
  return `[storage] driver=${STANDARD_OBJECT_STORAGE_DRIVER} host=${host} bucket=${getSupabaseStorageBucket()} prefix=${getSupabaseStoragePrefix()}/`;
}

/**
 * Validate Supabase Storage env (sync). Call at startup after env is loaded — not at module import time.
 */
export function ensureSupabaseStorageConfigReady(): void {
  requireSupabaseUrl();
  requireSupabaseServiceRoleKey();
  assertSharedSupabaseStorageConfig();
}

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  ensureSupabaseStorageConfigReady();
  cached = createClient(requireSupabaseUrl(), requireSupabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    /** Node 20 has no native WebSocket; realtime-js still constructs on createClient. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ws transport typing vs realtime-js WebSocketLikeConstructor
    realtime: { transport: ws as any },
  });
  return cached;
}

/** Fail fast when the configured bucket does not exist (common ECS misconfiguration). */
export async function verifySupabaseStorageBucketReady(): Promise<void> {
  const bucket = getSupabaseStorageBucket();
  const admin = getSupabaseAdmin();
  const { data: buckets, error } = await admin.storage.listBuckets();
  if (error) {
    throw new Error(`Supabase Storage listBuckets failed: ${error.message}`);
  }
  if (!buckets?.some((b) => b.name === bucket)) {
    throw new Error(
      `Supabase Storage bucket "${bucket}" not found. Run: npm run storage:ensure-bucket (same SUPABASE_URL as this server).`,
    );
  }
}

/** True when Storage API reports a missing object (not a permission/network failure). */
export function isSupabaseStorageNotFoundError(error: { message?: string; statusCode?: string | number } | null): boolean {
  if (!error) return false;
  const msg = String(error.message ?? "").toLowerCase();
  if (msg.includes("not found") || msg.includes("object not found")) return true;
  const code = String(error.statusCode ?? "");
  return code === "404";
}
