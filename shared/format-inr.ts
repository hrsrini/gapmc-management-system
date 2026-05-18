/** Standard INR display: ₹ prefix with Indian locale grouping (en-IN). */
export function formatInr(
  n: unknown,
  options?: { minimumFractionDigits?: number; maximumFractionDigits?: number },
): string {
  if (n == null || n === "") return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `₹${v.toLocaleString("en-IN", {
    minimumFractionDigits: options?.minimumFractionDigits ?? 0,
    maximumFractionDigits: options?.maximumFractionDigits ?? 2,
  })}`;
}

/** Ledger-style signed INR (e.g. +₹1,00,000 / -₹50,000). */
export function formatInrSigned(
  n: unknown,
  options?: { minimumFractionDigits?: number; maximumFractionDigits?: number },
): string {
  if (n == null || n === "") return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return formatInr(0, options);
  const sign = v > 0 ? "+" : "-";
  return `${sign}${formatInr(Math.abs(v), options)}`;
}

/** PDF / WinAnsi fonts: Indian grouping with Rs. prefix (rupee glyph may not render). */
export function formatInrPdf(
  n: unknown,
  options?: { minimumFractionDigits?: number; maximumFractionDigits?: number },
): string {
  return formatInr(n, options).replace(/\u20b9/g, "Rs.");
}
