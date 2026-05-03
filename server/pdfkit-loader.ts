/** Resolve pdfkit constructor for both ESM default and CJS `module.exports` shapes. */
export async function loadPdfDocumentConstructor(): Promise<typeof import("pdfkit")> {
  const mod = await import("pdfkit");
  const raw = (mod as { default?: unknown }).default ?? mod;
  if (typeof raw !== "function") {
    throw new Error("pdfkit export is not a constructor");
  }
  return raw as typeof import("pdfkit");
}
