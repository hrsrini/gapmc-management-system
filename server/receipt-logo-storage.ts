import fs from "fs";
import path from "path";

const LOGO_BASENAME = "receipt-pdf-logo";

export function receiptBrandingDir(): string {
  return path.join(process.cwd(), "uploads", "branding");
}

/** Remove any previously uploaded receipt logo files (png / jpg / jpeg). */
export function clearReceiptLogoFiles(): void {
  const dir = receiptBrandingDir();
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(LOGO_BASENAME)) {
      try {
        fs.unlinkSync(path.join(dir, name));
      } catch {
        /* ignore */
      }
    }
  }
}

/** Absolute path to uploaded logo, or null if none. */
export function getUploadedReceiptLogoPath(): string | null {
  const dir = receiptBrandingDir();
  for (const ext of ["png", "jpg", "jpeg"]) {
    const p = path.join(dir, `${LOGO_BASENAME}.${ext}`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function readUploadedReceiptLogoBuffer(): Buffer | null {
  const p = getUploadedReceiptLogoPath();
  if (!p) return null;
  try {
    return fs.readFileSync(p);
  } catch {
    return null;
  }
}

export function mimeForReceiptLogoPath(filePath: string): string {
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

/** Write PNG or JPEG upload (from memory). Clears any prior logo first. */
export function writeReceiptLogoUpload(buffer: Buffer, mime: string): void {
  clearReceiptLogoFiles();
  const dir = receiptBrandingDir();
  fs.mkdirSync(dir, { recursive: true });
  const ext = mime === "image/jpeg" ? "jpg" : "png";
  fs.writeFileSync(path.join(dir, `${LOGO_BASENAME}.${ext}`), buffer);
}
