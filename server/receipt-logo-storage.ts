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
  const key = await getActiveReceiptLogoKey();
  if (!key) return null;
  return getUploadBlobStore().get(key);
}

export async function writeReceiptLogoUpload(buffer: Buffer, mime: string): Promise<void> {
  await clearReceiptLogoFiles();
  const ext = mime === "image/jpeg" ? "jpg" : "png";
  const key = `branding/receipt-pdf-logo.${ext}`;
  const ct = mime === "image/jpeg" ? "image/jpeg" : "image/png";
  await getUploadBlobStore().put(key, buffer, ct);
}

export async function clearReceiptLogoFiles(): Promise<void> {
  const store = getUploadBlobStore();
  for (const k of LOGO_KEYS) {
    await store.del(k);
  }
}
