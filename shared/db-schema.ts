/**
 * Drizzle schema for GAPMC app. All tables live in the "gapmc" PostgreSQL schema
 * so existing database tables (e.g. in public) are never touched.
 */
import {
  pgSchema,
  text,
  integer,
  doublePrecision,
  boolean,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";

export const gapmc = pgSchema("gapmc");

// Enums as text columns with app-defined values (no PG enum to avoid touching DB types)
// Traders
export const traders = gapmc.table("traders", {
  id: text("id").primaryKey(),
  assetId: text("asset_id").notNull(),
  name: text("name").notNull(),
  firmName: text("firm_name"),
  type: text("type").notNull(), // Individual | Firm | Pvt Ltd | Public Ltd
  mobile: text("mobile").notNull(),
  phone: text("phone"),
  email: text("email").notNull(),
  residentialAddress: text("residential_address"),
  businessAddress: text("business_address"),
  aadhaar: text("aadhaar").notNull(),
  pan: text("pan").notNull(),
  gst: text("gst"),
  epicVoterId: text("epic_voter_id"),
  bankName: text("bank_name"),
  accountNumber: text("account_number"),
  ifscCode: text("ifsc_code"),
  branchName: text("branch_name"),
  yardId: integer("yard_id").notNull(),
  yardName: text("yard_name").notNull(),
  premises: text("premises").notNull(),
  premisesType: text("premises_type").notNull(), // Stall | Godown | Shop
  registrationType: text("registration_type").notNull(), // Temporary | Permanent
  commodities: jsonb("commodities").$type<string[]>().notNull(),
  status: text("status").notNull(), // Active | Inactive | Pending
  agreementStart: text("agreement_start"),
  agreementEnd: text("agreement_end"),
  rentAmount: doublePrecision("rent_amount").notNull(),
  securityDeposit: doublePrecision("security_deposit").notNull(),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
});

// Invoices
export const invoices = gapmc.table("invoices", {
  id: text("id").primaryKey(),
  traderId: text("trader_id").notNull(),
  traderName: text("trader_name").notNull(),
  premises: text("premises").notNull(),
  yard: text("yard").notNull(),
  yardId: integer("yard_id").notNull(),
  month: text("month").notNull(),
  invoiceDate: text("invoice_date").notNull(),
  baseRent: doublePrecision("base_rent").notNull(),
  cgst: doublePrecision("cgst").notNull(),
  sgst: doublePrecision("sgst").notNull(),
  interest: doublePrecision("interest").notNull(),
  total: doublePrecision("total").notNull(),
  tdsApplicable: boolean("tds_applicable").notNull(),
  tdsAmount: doublePrecision("tds_amount").notNull(),
  status: text("status").notNull(), // Paid | Pending | Overdue | Draft
  notes: text("notes"),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
});

// Receipts
export const receipts = gapmc.table("receipts", {
  id: text("id").primaryKey(),
  receiptNo: text("receipt_no").notNull(),
  receiptDate: text("receipt_date").notNull(),
  type: text("type").notNull(), // Rent | Market Fee | License Fee | Other
  traderId: text("trader_id").notNull(),
  traderName: text("trader_name").notNull(),
  head: text("head").notNull(),
  amount: doublePrecision("amount").notNull(),
  cgst: doublePrecision("cgst"),
  sgst: doublePrecision("sgst"),
  interest: doublePrecision("interest"),
  securityDeposit: doublePrecision("security_deposit"),
  tdsAmount: doublePrecision("tds_amount"),
  total: doublePrecision("total").notNull(),
  paymentMode: text("payment_mode").notNull(), // Cash | Cheque | Online | Adjustment
  chequeNo: text("cheque_no"),
  chequeBank: text("cheque_bank"),
  chequeDate: text("cheque_date"),
  transactionRef: text("transaction_ref"),
  narration: text("narration"),
  yardId: integer("yard_id").notNull(),
  yardName: text("yard_name").notNull(),
  issuedBy: text("issued_by").notNull(),
  status: text("status").notNull(), // Active | Voided
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
});

// Market fees
export const marketFees = gapmc.table("market_fees", {
  id: text("id").primaryKey(),
  receiptNo: text("receipt_no").notNull(),
  entryDate: text("entry_date").notNull(),
  entryType: text("entry_type").notNull(), // Import | Export
  traderId: text("trader_id").notNull(),
  traderName: text("trader_name").notNull(),
  licenseNo: text("license_no").notNull(),
  address: text("address"),
  gstPan: text("gst_pan"),
  commodity: text("commodity").notNull(),
  commodityType: text("commodity_type").notNull(), // Horticultural | Non-Horticultural
  quantity: doublePrecision("quantity").notNull(),
  unit: text("unit").notNull(), // Kg | Quintal | Ton | Pieces | Crates
  ratePerUnit: doublePrecision("rate_per_unit").notNull(),
  totalValue: doublePrecision("total_value").notNull(),
  marketFee: doublePrecision("market_fee").notNull(),
  vehicleType: text("vehicle_type").notNull(),
  vehicleNumber: text("vehicle_number").notNull(),
  locationId: integer("location_id").notNull(),
  locationName: text("location_name").notNull(),
  paymentMode: text("payment_mode").notNull(), // Cash | Cheque | Online
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
});

// Agreements
export const agreements = gapmc.table("agreements", {
  id: text("id").primaryKey(),
  agreementId: text("agreement_id").notNull(),
  traderId: text("trader_id").notNull(),
  traderName: text("trader_name").notNull(),
  premises: text("premises").notNull(),
  yardId: integer("yard_id").notNull(),
  yardName: text("yard_name").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  rentAmount: doublePrecision("rent_amount").notNull(),
  securityDeposit: doublePrecision("security_deposit").notNull(),
  status: text("status").notNull(), // Active | Expiring Soon | Expired | Terminated
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
});

// Stock returns
export const stockReturns = gapmc.table("stock_returns", {
  id: text("id").primaryKey(),
  traderId: text("trader_id").notNull(),
  traderName: text("trader_name").notNull(),
  period: text("period").notNull(),
  commodity: text("commodity").notNull(),
  openingBalance: doublePrecision("opening_balance").notNull(),
  locallyProcured: doublePrecision("locally_procured").notNull(),
  purchasedFromTrader: doublePrecision("purchased_from_trader").notNull(),
  sales: doublePrecision("sales").notNull(),
  closingBalance: doublePrecision("closing_balance").notNull(),
  status: text("status").notNull(), // Draft | Submitted
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
});

// Activity logs
export const activityLogs = gapmc.table("activity_logs", {
  id: text("id").primaryKey(),
  action: text("action").notNull(),
  module: text("module").notNull(),
  user: text("user").notNull(),
  timestamp: text("timestamp").notNull(),
  details: text("details"),
});
