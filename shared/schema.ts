import { z } from "zod";
import { INDIAN_MOBILE_10_RE, isStrictAadhaar12Digits, isValidEmailFormat } from "./india-validation";

const traderMobileSchema = z
  .string()
  .transform((s) => s.replace(/\D/g, ""))
  .refine((s) => INDIAN_MOBILE_10_RE.test(s), {
    message: "Mobile must be a valid 10-digit Indian number.",
  });

const traderEmailSchema = z
  .string()
  .trim()
  .refine((s) => isValidEmailFormat(s), { message: "Please enter a valid email address." })
  .transform((s) => s.trim().toLowerCase());

const traderAadhaarSchema = z
  .string()
  .trim()
  .refine((s) => isStrictAadhaar12Digits(s), {
    message: "Please enter a valid Aadhaar number (12 digits, no spaces or hyphens).",
  });

// Trader schema
export const traderSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  name: z.string(),
  firmName: z.string().optional(),
  type: z.enum(['Individual', 'Firm', 'Pvt Ltd', 'Public Ltd']),
  mobile: traderMobileSchema,
  phone: z.string().optional(),
  email: traderEmailSchema,
  residentialAddress: z.string().optional(),
  businessAddress: z.string().optional(),
  aadhaar: traderAadhaarSchema,
  pan: z.string(),
  gst: z.string().optional(),
  epicVoterId: z.string().optional(),
  bankName: z.string().optional(),
  accountNumber: z.string().optional(),
  ifscCode: z.string().optional(),
  branchName: z.string().optional(),
  yardId: z.number(),
  yardName: z.string(),
  premises: z.string(),
  premisesType: z.enum(['Stall', 'Godown', 'Shop']),
  registrationType: z.enum(['Temporary', 'Permanent']),
  commodities: z.array(z.string()),
  status: z.enum(['Active', 'Inactive', 'Pending']),
  agreementStart: z.string().optional(),
  agreementEnd: z.string().optional(),
  rentAmount: z.number(),
  securityDeposit: z.number(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type Trader = z.infer<typeof traderSchema>;
export const insertTraderSchema = traderSchema.omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTrader = z.infer<typeof insertTraderSchema>;

// Invoice schema
export const invoiceSchema = z.object({
  id: z.string(),
  traderId: z.string(),
  traderName: z.string(),
  premises: z.string(),
  yard: z.string(),
  yardId: z.number(),
  month: z.string(),
  invoiceDate: z.string(),
  baseRent: z.number(),
  cgst: z.number(),
  sgst: z.number(),
  interest: z.number(),
  total: z.number(),
  tdsApplicable: z.boolean(),
  tdsAmount: z.number(),
  status: z.enum(['Paid', 'Pending', 'Overdue', 'Draft']),
  notes: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type Invoice = z.infer<typeof invoiceSchema>;
export const insertInvoiceSchema = invoiceSchema.omit({ id: true, createdAt: true, updatedAt: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;

// Receipt schema
export const receiptSchema = z.object({
  id: z.string(),
  receiptNo: z.string(),
  receiptDate: z.string(),
  type: z.enum(['Rent', 'Market Fee', 'License Fee', 'Other']),
  traderId: z.string(),
  traderName: z.string(),
  head: z.string(),
  amount: z.number(),
  cgst: z.number().optional(),
  sgst: z.number().optional(),
  interest: z.number().optional(),
  securityDeposit: z.number().optional(),
  tdsAmount: z.number().optional(),
  total: z.number(),
  paymentMode: z.enum(['Cash', 'Cheque', 'Online', 'Adjustment']),
  chequeNo: z.string().optional(),
  chequeBank: z.string().optional(),
  chequeDate: z.string().optional(),
  transactionRef: z.string().optional(),
  narration: z.string().optional(),
  yardId: z.number(),
  yardName: z.string(),
  issuedBy: z.string(),
  status: z.enum(['Active', 'Voided']),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type Receipt = z.infer<typeof receiptSchema>;
export const insertReceiptSchema = receiptSchema.omit({ id: true, createdAt: true, updatedAt: true });
export type InsertReceipt = z.infer<typeof insertReceiptSchema>;

// Market Fee Entry schema
export const marketFeeSchema = z.object({
  id: z.string(),
  receiptNo: z.string(),
  entryDate: z.string(),
  entryType: z.enum(['Import', 'Export']),
  traderId: z.string(),
  traderName: z.string(),
  licenseNo: z.string(),
  address: z.string().optional(),
  gstPan: z.string().optional(),
  commodity: z.string(),
  commodityType: z.enum(['Horticultural', 'Non-Horticultural']),
  quantity: z.number(),
  unit: z.enum(['Kg', 'Quintal', 'Ton', 'Pieces', 'Crates']),
  ratePerUnit: z.number(),
  totalValue: z.number(),
  marketFee: z.number(),
  vehicleType: z.string(),
  vehicleNumber: z.string(),
  locationId: z.number(),
  locationName: z.string(),
  paymentMode: z.enum(['Cash', 'Cheque', 'Online']),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type MarketFee = z.infer<typeof marketFeeSchema>;
export const insertMarketFeeSchema = marketFeeSchema.omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMarketFee = z.infer<typeof insertMarketFeeSchema>;

// Agreement schema
export const agreementSchema = z.object({
  id: z.string(),
  agreementId: z.string(),
  traderId: z.string(),
  traderName: z.string(),
  premises: z.string(),
  yardId: z.number(),
  yardName: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  rentAmount: z.number(),
  securityDeposit: z.number(),
  status: z.enum(['Active', 'Expiring Soon', 'Expired', 'Terminated']),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type Agreement = z.infer<typeof agreementSchema>;
export const insertAgreementSchema = agreementSchema.omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAgreement = z.infer<typeof insertAgreementSchema>;

// Stock Returns schema
export const stockReturnSchema = z.object({
  id: z.string(),
  traderId: z.string(),
  traderName: z.string(),
  period: z.string(),
  commodity: z.string(),
  openingBalance: z.number(),
  locallyProcured: z.number(),
  purchasedFromTrader: z.number(),
  sales: z.number(),
  closingBalance: z.number(),
  status: z.enum(['Draft', 'Submitted']),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type StockReturn = z.infer<typeof stockReturnSchema>;
export const insertStockReturnSchema = stockReturnSchema.omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStockReturn = z.infer<typeof insertStockReturnSchema>;

// Activity Log schema
export const activityLogSchema = z.object({
  id: z.string(),
  action: z.string(),
  module: z.string(),
  user: z.string(),
  timestamp: z.string(),
  details: z.string().optional(),
});

export type ActivityLog = z.infer<typeof activityLogSchema>;

// Keep existing User types for compatibility
export const users = {
  id: "varchar",
  username: "text",
  password: "text",
};

export type User = {
  id: string;
  username: string;
  password: string;
};

export type InsertUser = Omit<User, 'id'>;
export const insertUserSchema = z.object({
  username: z.string(),
  password: z.string(),
});
