/** Download server-generated IOMS receipt PDF to the user's downloads folder. */
export async function downloadIomsReceiptPdf(receiptId: string, receiptNo: string): Promise<void> {
  const res = await fetch(`/api/ioms/receipts/${encodeURIComponent(receiptId)}/pdf`, {
    credentials: "include",
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || res.statusText);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `receipt-${receiptNo.replace(/[^\w.-]+/g, "_")}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
