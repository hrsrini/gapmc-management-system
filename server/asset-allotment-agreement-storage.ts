import fs from "fs/promises";
import path from "path";
import { ensureLocalUploadsRoot } from "./object-storage";

const DIR = "asset-allotment-agreements";

export function extFromAssetAllotmentAgreementMime(mime: string): string | null {
  const m = String(mime ?? "").toLowerCase();
  if (m === "application/pdf") return ".pdf";
  return null;
}

export function isAllowedAssetAllotmentAgreementFileName(fileName: string): boolean {
  return /^agreement-\d{10,}-[a-zA-Z0-9_-]{6,}\.pdf$/.test(String(fileName ?? ""));
}

export function contentTypeForAssetAllotmentAgreement(_fileName: string): string {
  return "application/pdf";
}

function allotmentDir(allotmentId: string): string {
  ensureLocalUploadsRoot();
  const root = process.env.UPLOADS_DIR ? String(process.env.UPLOADS_DIR) : path.join(process.cwd(), "uploads");
  return path.join(root, DIR, allotmentId);
}

export async function writeAssetAllotmentAgreementBuffer(allotmentId: string, fileName: string, buf: Buffer): Promise<void> {
  const dir = allotmentDir(allotmentId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileName), buf);
}

export async function readAssetAllotmentAgreementBuffer(allotmentId: string, fileName: string): Promise<Buffer | null> {
  try {
    const p = path.join(allotmentDir(allotmentId), fileName);
    return await fs.readFile(p);
  } catch {
    return null;
  }
}

