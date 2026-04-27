/**
 * Upload blob storage: local `uploads/<key>` or S3-compatible bucket (SRS §15.1).
 * Keys are relative paths (no leading slash), e.g. `dak/inward/{id}/{file}.pdf`.
 *
 * Local disk root defaults to `<project>/uploads` (parent of `server/` in dev, parent of `dist/` when
 * running `node dist/index.cjs`), not `process.cwd()/uploads`, so reads/writes stay aligned if the
 * process working directory is not the repo root.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile, unlink, stat } from "fs/promises";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

export type ObjectStorageDriver = "local" | "s3";

export interface ObjectStorageAdapter {
  readonly driver: ObjectStorageDriver;
}

export function getConfiguredObjectStorageDriver(): ObjectStorageDriver {
  const d = (process.env.OBJECT_STORAGE_DRIVER ?? "local").trim().toLowerCase();
  return d === "s3" ? "s3" : "local";
}

export function getObjectStorageAdapter(): ObjectStorageAdapter {
  return { driver: getConfiguredObjectStorageDriver() };
}

/** Reject path traversal and absolute paths. */
export function assertSafeUploadRelativeKey(key: string): string {
  const k = String(key ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!k || k.includes("..") || k.includes("\0")) {
    throw new Error("INVALID_UPLOAD_KEY");
  }
  return k;
}

export interface UploadBlobStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  del(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

// When bundled to CJS for production (`dist/index.cjs`), Node provides `__filename`.
// In ESM dev, `__filename` is not defined.
declare const __filename: string | undefined;

/** Application / repo root for resolving `uploads/` (override when deployment layout differs). */
export function resolveProjectRootDir(): string {
  const env = (process.env.GAPMC_PROJECT_ROOT ?? "").trim();
  if (env) {
    return path.isAbsolute(env) ? env : path.resolve(process.cwd(), env);
  }
  // `dist/index.cjs` is built as CJS; `import.meta.url` becomes undefined at runtime.
  // Use `__filename` when available, otherwise fall back to `import.meta.url`.
  const cjsFile = typeof __filename === "string" ? __filename : null;
  const thisFile =
    cjsFile ??
    (() => {
      try {
        // In ESM dev, this works.
        return fileURLToPath(import.meta.url);
      } catch {
        // As a last resort, align with current working dir.
        return path.join(process.cwd(), "server", "object-storage.ts");
      }
    })();
  return path.join(path.dirname(thisFile), "..");
}

/**
 * Directory where local blob keys are stored (`employees/...`, `agreements/...`, etc.).
 * Default: `<project>/uploads`. Set `LOCAL_UPLOADS_DIR` to an absolute path, or a path relative to the project root.
 */
export function resolveLocalUploadsRoot(): string {
  const sub = (process.env.LOCAL_UPLOADS_DIR ?? "").trim();
  const root = resolveProjectRootDir();
  if (!sub) return path.join(root, "uploads");
  return path.isAbsolute(sub) ? sub : path.join(root, sub);
}

function uploadsRoot(): string {
  return resolveLocalUploadsRoot();
}

class LocalUploadBlobStore implements UploadBlobStore {
  private absKey(key: string): string {
    return path.join(uploadsRoot(), assertSafeUploadRelativeKey(key));
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    const abs = this.absKey(key);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, body);
  }

  async get(key: string): Promise<Buffer | null> {
    const abs = this.absKey(key);
    try {
      return await readFile(abs);
    } catch (e: unknown) {
      if (e && typeof e === "object" && (e as { code?: string }).code === "ENOENT") return null;
      throw e;
    }
  }

  async del(key: string): Promise<void> {
    const abs = this.absKey(key);
    try {
      await unlink(abs);
    } catch (e: unknown) {
      if (e && typeof e === "object" && (e as { code?: string }).code === "ENOENT") return;
      throw e;
    }
  }

  async exists(key: string): Promise<boolean> {
    const abs = this.absKey(key);
    try {
      const s = await stat(abs);
      return s.isFile();
    } catch {
      return false;
    }
  }
}

function s3HttpStatus(e: unknown): number | undefined {
  if (e && typeof e === "object" && "$metadata" in e) {
    return (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  }
  return undefined;
}

class S3UploadBlobStore implements UploadBlobStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly sse: "none" | "AES256";

  constructor() {
    const bucket = (process.env.S3_BUCKET ?? process.env.OBJECT_STORAGE_S3_BUCKET ?? "").trim();
    if (!bucket) {
      throw new Error("S3_BUCKET (or OBJECT_STORAGE_S3_BUCKET) is required when OBJECT_STORAGE_DRIVER=s3");
    }
    const region =
      (process.env.S3_REGION ?? process.env.AWS_REGION ?? "ap-south-1").trim() || "ap-south-1";
    const endpoint = (process.env.S3_ENDPOINT ?? "").trim() || undefined;
    const forcePathStyle =
      String(process.env.S3_FORCE_PATH_STYLE ?? "").toLowerCase() === "true" ||
      Boolean(endpoint);
    const sseRaw = (process.env.S3_SERVER_SIDE_ENCRYPTION ?? process.env.OBJECT_STORAGE_SSE ?? "none")
      .trim()
      .toUpperCase();
    this.sse = sseRaw === "AES256" ? "AES256" : "none";
    const accessKeyId = (process.env.S3_ACCESS_KEY_ID ?? "").trim();
    const secretAccessKey = (process.env.S3_SECRET_ACCESS_KEY ?? "").trim();
    this.client = new S3Client({
      region,
      endpoint,
      forcePathStyle,
      ...(accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey } }
        : {}),
    });
    this.bucket = bucket;
    const p = (process.env.S3_PREFIX ?? "").trim().replace(/\\/g, "/");
    this.prefix = p && !p.endsWith("/") ? `${p}/` : p;
  }

  private objectKey(key: string): string {
    return `${this.prefix}${assertSafeUploadRelativeKey(key)}`;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key),
        Body: body,
        ContentType: contentType || "application/octet-stream",
        ...(this.sse === "AES256" ? { ServerSideEncryption: "AES256" } : {}),
      }),
    );
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
      );
      const body = out.Body;
      if (!body) return null;
      const chunks: Buffer[] = [];
      for await (const chunk of body as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
      }
      return chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0);
    } catch (e: unknown) {
      const http = s3HttpStatus(e);
      const name = e && typeof e === "object" && "name" in e ? String((e as { name?: string }).name) : "";
      if (http === 404 || name === "NoSuchKey") return null;
      throw e;
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
      );
    } catch {
      /* ignore */
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
      );
      return true;
    } catch (e: unknown) {
      if (s3HttpStatus(e) === 404) return false;
      throw e;
    }
  }
}

let cachedStore: UploadBlobStore | null = null;

export function getUploadBlobStore(): UploadBlobStore {
  if (cachedStore) return cachedStore;
  const driver = getConfiguredObjectStorageDriver();
  cachedStore = driver === "s3" ? new S3UploadBlobStore() : new LocalUploadBlobStore();
  return cachedStore;
}

/** Ensure base `uploads/` exists on local disk (no-op for pure S3). */
export function ensureLocalUploadsRoot(): void {
  if (getConfiguredObjectStorageDriver() === "local") {
    try {
      fs.mkdirSync(uploadsRoot(), { recursive: true });
    } catch {
      /* ignore */
    }
  }
}
