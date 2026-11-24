import fs from "node:fs";
import type PDFDocument from "pdfkit";

type PdfDoc = InstanceType<typeof PDFDocument>;

const FONT_NAME = "ReceiptRupee";
const CANDIDATES = [
  "C:\\Windows\\Fonts\\segoeui.ttf",
  "C:\\Windows\\Fonts\\arial.ttf",
  "C:\\Windows\\Fonts\\calibri.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
];

let cachedPath: string | null | undefined;

function resolveRupeeFontPath(): string | null {
  if (cachedPath !== undefined) return cachedPath;
  for (const p of CANDIDATES) {
    try {
      if (fs.existsSync(p)) {
        cachedPath = p;
        return p;
      }
    } catch {
      /* try next */
    }
  }
  cachedPath = null;
  return null;
}

const registered = new WeakSet<object>();

/** Register a Unicode-capable font so ₹ renders on amount cells. */
export function ensureReceiptRupeeFont(doc: PdfDoc): string | null {
  if (registered.has(doc as object)) return FONT_NAME;
  const path = resolveRupeeFontPath();
  if (!path) return null;
  try {
    doc.registerFont(FONT_NAME, path);
    registered.add(doc as object);
    return FONT_NAME;
  } catch {
    return null;
  }
}

/** Draw amount text with ₹ when a Unicode font is available; else fall back to Rs. */
export function drawReceiptAmountText(
  doc: PdfDoc,
  text: string,
  x: number,
  y: number,
  opts: { width: number; align: "left" | "right" | "center"; bold?: boolean },
): void {
  const font = ensureReceiptRupeeFont(doc);
  if (font) {
    doc.font(font).fontSize(opts.bold ? 8.5 : 8);
    doc.text(text, x, y, { width: opts.width, align: opts.align, lineBreak: false });
    doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica");
    return;
  }
  const safe = text.replace(/\u20b9/g, "Rs.");
  doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(opts.bold ? 8.5 : 8);
  doc.text(safe, x, y, { width: opts.width, align: opts.align, lineBreak: false });
}
