/**
 * Placeholder for SRS object storage (S3-compatible) vs local disk (`uploads/`).
 * Dak, vouchers, and receipt branding currently use local paths; wire adapters here when infra is ready.
 */
export type ObjectStorageDriver = "local" | "s3";

export interface ObjectStorageAdapter {
  /** Logical key (e.g. dak/inward/{id}/scan.pdf). */
  readonly driver: ObjectStorageDriver;
}

export function getConfiguredObjectStorageDriver(): ObjectStorageDriver {
  const d = (process.env.OBJECT_STORAGE_DRIVER ?? "local").trim().toLowerCase();
  return d === "s3" ? "s3" : "local";
}

export function getObjectStorageAdapter(): ObjectStorageAdapter {
  return { driver: getConfiguredObjectStorageDriver() };
}
