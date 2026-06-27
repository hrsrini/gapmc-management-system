import { getUploadBlobStore } from "./object-storage";

const LOGO_KEYS = ["branding/receipt-pdf-logo.png", "branding/receipt-pdf-logo.jpg", "branding/receipt-pdf-logo.jpeg"] as const;

export async function getActiveReceiptLogoKey(): Promise<string | null> {
  const store = getUploadBlobStore();
  for (const k of LOGO_KEYS) {
    if (await store.exists(k)) return k;
  }
  return null;
}

export async function hasUploadedReceiptLogo(): Promise<boolean> {
  return (await getActiveReceiptLogoKey()) != null;
}

/** Storage ref (blob key) for the active logo, or null. */
export async function getUploadedReceiptLogoPath(): Promise<string | null> {
  return getActiveReceiptLogoKey();
}

export function mimeForReceiptLogoKey(key: string): string {
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

/** @deprecated Use mimeForReceiptLogoKey with blob key from getActiveReceiptLogoKey. */
export function mimeForReceiptLogoPath(filePathOrKey: string): string {
  return mimeForReceiptLogoKey(filePathOrKey);
}

export async function readUploadedReceiptLogoBuffer(): Promise<Buffer | null> {
  try {
    const key = await getActiveReceiptLogoKey();
    if (!key) return null;
    const buf = await getUploadBlobStore().get(key);
    if (!buf?.length) return null;
    return buf;
  } catch (e) {
    /* S3/network errors must not block receipt PDFs */
    console.warn("[receipt-logo] read skipped", e);
    return null;
  }
}

function receiptLogoExtFromMime(mime: string): "jpg" | "png" {
  const normalized = mime.toLowerCase().split(";")[0].trim();
  if (normalized === "image/jpeg" || normalized === "image/jpg" || normalized === "image/pjpeg") {
    return "jpg";
  }
  return "png";
}

export async function writeReceiptLogoUpload(buffer: Buffer, mime: string): Promise<void> {
  try {
    await clearReceiptLogoFiles();
  } catch (e) {
    console.warn("[receipt-logo] clear before upload failed (continuing)", e);
  }
  const ext = receiptLogoExtFromMime(mime);
  const key = `branding/receipt-pdf-logo.${ext}`;
  const contentType = ext === "jpg" ? "image/jpeg" : "image/png";
  await getUploadBlobStore().put(key, buffer, contentType);
}

export async function clearReceiptLogoFiles(): Promise<void> {
  const store = getUploadBlobStore();
  for (const k of LOGO_KEYS) {
    await store.del(k);
  }
}
