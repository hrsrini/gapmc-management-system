import { getUploadBlobStore } from "./object-storage";

const SIGNATURE_KEYS = [
  "branding/leave-order-secretary-signature.png",
  "branding/leave-order-secretary-signature.jpg",
  "branding/leave-order-secretary-signature.jpeg",
] as const;

export async function loadActiveLeaveOrderSignature(): Promise<{ key: string; buffer: Buffer } | null> {
  const store = getUploadBlobStore();
  for (const k of SIGNATURE_KEYS) {
    try {
      const buf = await store.get(k);
      if (buf != null && buf.length > 0) return { key: k, buffer: buf };
    } catch (e) {
      console.warn(`[leave-signature] get ${k} failed`, e);
    }
  }
  return null;
}

export async function hasUploadedLeaveOrderSignature(): Promise<boolean> {
  return (await loadActiveLeaveOrderSignature()) != null;
}

export function mimeForLeaveOrderSignatureKey(key: string): string {
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".jpg") || key.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

export async function readUploadedLeaveOrderSignatureBuffer(): Promise<Buffer | null> {
  try {
    const loaded = await loadActiveLeaveOrderSignature();
    return loaded?.buffer ?? null;
  } catch (e) {
    console.warn("[leave-signature] read skipped", e);
    return null;
  }
}

function extFromMime(mime: string): "jpg" | "png" {
  const normalized = mime.toLowerCase().split(";")[0].trim();
  if (normalized === "image/jpeg" || normalized === "image/jpg" || normalized === "image/pjpeg") {
    return "jpg";
  }
  return "png";
}

export async function writeLeaveOrderSignatureUpload(buffer: Buffer, mime: string): Promise<void> {
  try {
    await clearLeaveOrderSignatureFiles();
  } catch (e) {
    console.warn("[leave-signature] clear before upload failed (continuing)", e);
  }
  const ext = extFromMime(mime);
  const key = `branding/leave-order-secretary-signature.${ext}`;
  const contentType = ext === "jpg" ? "image/jpeg" : "image/png";
  await getUploadBlobStore().put(key, buffer, contentType);
}

export async function clearLeaveOrderSignatureFiles(): Promise<void> {
  const store = getUploadBlobStore();
  for (const k of SIGNATURE_KEYS) {
    await store.del(k);
  }
}
