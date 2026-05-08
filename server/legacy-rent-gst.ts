import { computeRentInvoiceGstInr, rentInvoiceTotalInr } from "@shared/rent-invoice-gst";
import { getMergedSystemConfig, parseSystemConfigNumber } from "./system-config";

/** Legacy gapmc.invoices: CGST/SGST on base rent + total incl. interest/TDS. */
export async function computeLegacyInvoiceGstFields(input: {
  baseRent: number;
  interest: number;
  tdsApplicable: boolean;
  tdsAmount: number;
}): Promise<{ cgst: number; sgst: number; total: number }> {
  const cfg = await getMergedSystemConfig();
  const pc = parseSystemConfigNumber(cfg, "rent_invoice_cgst_percent");
  const ps = parseSystemConfigNumber(cfg, "rent_invoice_sgst_percent");
  const { cgst, sgst } = computeRentInvoiceGstInr(input.baseRent, false, pc, ps);
  const rentPlusGst = rentInvoiceTotalInr(input.baseRent, 0, cgst, sgst);
  const total =
    Math.round((rentPlusGst + input.interest - (input.tdsApplicable ? input.tdsAmount : 0)) * 100) / 100;
  return { cgst, sgst, total };
}

/** Legacy gapmc.receipts (type Rent): CGST/SGST on rent `amount` + line total. */
export async function computeLegacyRentReceiptGstFields(input: {
  rentAmount: number;
  interestRent: number;
  securityDeposit: number;
  tdsRent: number;
}): Promise<{ cgst: number; sgst: number; total: number }> {
  const cfg = await getMergedSystemConfig();
  const pc = parseSystemConfigNumber(cfg, "rent_invoice_cgst_percent");
  const ps = parseSystemConfigNumber(cfg, "rent_invoice_sgst_percent");
  const { cgst, sgst } = computeRentInvoiceGstInr(input.rentAmount, false, pc, ps);
  const sub = rentInvoiceTotalInr(input.rentAmount, 0, cgst, sgst);
  const total =
    Math.round((sub + input.interestRent + input.securityDeposit - input.tdsRent) * 100) / 100;
  return { cgst, sgst, total };
}
