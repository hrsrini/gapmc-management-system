/**
 * Drizzle schema for GAPMC app. All tables live in the "gapmc" PostgreSQL schema
 * so existing database tables (e.g. in public) are never touched.
 *
 * --- NO DATA LOSS POLICY ---
 * - Do NOT remove any table or column from this file. Additive changes only.
 * - Protected (live) tables: traders, invoices, receipts, market_fees, agreements,
 *   stock_returns, activity_logs. Never drop these or remove their columns.
 * - New IOMS tables can be added; never drop existing ones.
 * - When adding columns to existing tables: use nullable or DEFAULT so existing rows are unchanged.
 */
import {
  pgSchema,
  text,
  integer,
  doublePrecision,
  boolean,
  jsonb,
  primaryKey,
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

// ============== IOMS (GAPLMB) — All 10 Modules ==============
// Build order: M-10 → M-05 → M-01/M-02 → M-03/M-04 → M-06 → M-07/M-08/M-09

// ----- M-10: RBAC & System Administration -----
export const yards = gapmc.table("yards", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  type: text("type").notNull(), // Yard | CheckPost | HO
  phone: text("phone"),
  mobile: text("mobile"),
  address: text("address"),
  isActive: boolean("is_active").default(true),
});

export const users = gapmc.table("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  /** Optional login alias (unique when set); sign in with email or username. */
  username: text("username").unique(),
  name: text("name").notNull(),
  phone: text("phone"),
  employeeId: text("employee_id"), // FK → employees (M-01)
  passwordHash: text("password_hash"),
  isActive: boolean("is_active").default(true),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
});

export const roles = gapmc.table("roles", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  tier: text("tier").notNull(), // DO | DV | DA | READ_ONLY | ADMIN
  description: text("description"),
});

export const userRoles = gapmc.table(
  "user_roles",
  {
    userId: text("user_id").notNull(),
    roleId: text("role_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })]
);

export const permissions = gapmc.table("permissions", {
  id: text("id").primaryKey(),
  module: text("module").notNull(),
  action: text("action").notNull(), // Create | Read | Update | Delete | Approve
});

export const rolePermissions = gapmc.table(
  "role_permissions",
  {
    roleId: text("role_id").notNull(),
    permissionId: text("permission_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionId] })]
);

export const userYards = gapmc.table(
  "user_yards",
  {
    userId: text("user_id").notNull(),
    yardId: text("yard_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.yardId] })]
);

export const systemConfig = gapmc.table("system_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedBy: text("updated_by"),
  updatedAt: text("updated_at"),
});

export const slaConfig = gapmc.table("sla_config", {
  id: text("id").primaryKey(),
  workflow: text("workflow").notNull(),
  hours: integer("hours").notNull(),
  alertRole: text("alert_role"),
});

export const auditLog = gapmc.table("audit_log", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  module: text("module").notNull(),
  action: text("action").notNull(),
  recordId: text("record_id"),
  beforeValue: jsonb("before_value"),
  afterValue: jsonb("after_value"),
  ip: text("ip"),
  createdAt: text("created_at").notNull(),
});

/** Govt. office/godown holders exempt from GST (GAPLMB list). */
export const govtGstExemptCategories = gapmc.table("govt_gst_exempt_categories", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

/**
 * Tally chart of accounts (from tally_ledgers.pdf).
 * statementClass: PL_Income | PL_Expense | BS_Liability | BS_Asset
 */
export const tallyLedgers = gapmc.table("tally_ledgers", {
  id: text("id").primaryKey(),
  ledgerName: text("ledger_name").notNull(),
  primaryGroup: text("primary_group").notNull(),
  statementClass: text("statement_class").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").default(true),
});

/** Maps IOMS revenue_head string → Tally ledger for export (M-05). */
export const iomsRevenueHeadLedgerMap = gapmc.table("ioms_revenue_head_ledger_map", {
  revenueHead: text("revenue_head").primaryKey(),
  tallyLedgerId: text("tally_ledger_id").notNull(),
});

// ----- M-05: Receipts Online (central engine) -----
export const receiptSequence = gapmc.table(
  "receipt_sequence",
  {
    yardId: text("yard_id").notNull(),
    revenueHead: text("revenue_head").notNull(),
    financialYear: text("financial_year").notNull(),
    lastSeq: integer("last_seq").default(0).notNull(),
  },
  (t) => [primaryKey({ columns: [t.yardId, t.revenueHead, t.financialYear] })]
);

export const paymentGatewayLog = gapmc.table("payment_gateway_log", {
  id: text("id").primaryKey(),
  receiptId: text("receipt_id").notNull(),
  gateway: text("gateway").notNull(),
  gatewayTxnId: text("gateway_txn_id"),
  status: text("status").notNull(),
  amount: doublePrecision("amount").notNull(),
  gatewayResponse: jsonb("gateway_response"),
  createdAt: text("created_at").notNull(),
});

// IOMS receipts (M-05) — structured receipt_no GAPLMB/[LOC]/[FY]/[HEAD]/[NNN]
export const iomsReceipts = gapmc.table("ioms_receipts", {
  id: text("id").primaryKey(),
  receiptNo: text("receipt_no").notNull().unique(),
  yardId: text("yard_id").notNull(),
  revenueHead: text("revenue_head").notNull(), // Rent | GSTInvoice | MarketFee | LicenceFee | SecurityDeposit | Miscellaneous
  payerName: text("payer_name"),
  payerType: text("payer_type"),
  payerRefId: text("payer_ref_id"),
  amount: doublePrecision("amount").notNull(),
  cgst: doublePrecision("cgst").default(0),
  sgst: doublePrecision("sgst").default(0),
  totalAmount: doublePrecision("total_amount").notNull(),
  paymentMode: text("payment_mode").notNull(), // Online | Cash | Cheque | DD
  gatewayRef: text("gateway_ref"),
  chequeNo: text("cheque_no"),
  bankName: text("bank_name"),
  chequeDate: text("cheque_date"),
  sourceModule: text("source_module"), // M-02 | M-03 | M-04 | M-06 | M-08
  sourceRecordId: text("source_record_id"),
  qrCodeUrl: text("qr_code_url"),
  pdfUrl: text("pdf_url"),
  status: text("status").notNull(), // Pending | Paid | Failed | Reconciled
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
});

// ----- M-01: HRMS & Service Record -----
export const employees = gapmc.table("employees", {
  id: text("id").primaryKey(),
  empId: text("emp_id").unique(), // EMP-[LOC]-[YEAR]-[NNN] after DA approval
  firstName: text("first_name").notNull(),
  middleName: text("middle_name"),
  surname: text("surname").notNull(),
  photoUrl: text("photo_url"),
  designation: text("designation").notNull(),
  yardId: text("yard_id").notNull(),
  employeeType: text("employee_type").notNull(),
  aadhaarToken: text("aadhaar_token"),
  pan: text("pan"),
  dob: text("dob"),
  joiningDate: text("joining_date").notNull(),
  retirementDate: text("retirement_date"),
  mobile: text("mobile"),
  workEmail: text("work_email"),
  status: text("status").notNull(), // Active | Inactive | Suspended | Retired | Resigned
  userId: text("user_id"),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
});

export const employeeContracts = gapmc.table("employee_contracts", {
  id: text("id").primaryKey(),
  employeeId: text("employee_id").notNull(),
  contractType: text("contract_type").notNull(),
  payScale: text("pay_scale"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
});

export const recruitment = gapmc.table("recruitment", {
  id: text("id").primaryKey(),
  position: text("position").notNull(),
  applicantName: text("applicant_name").notNull(),
  qualification: text("qualification"),
  appliedDate: text("applied_date").notNull(),
  status: text("status").notNull(),
  interviewOutcomes: jsonb("interview_outcomes"),
  decision: text("decision"),
});

export const attendances = gapmc.table("attendances", {
  id: text("id").primaryKey(),
  employeeId: text("employee_id").notNull(),
  date: text("date").notNull(),
  action: text("action").notNull(), // CheckIn | CheckOut
  reason: text("reason"),
});

export const timesheets = gapmc.table("timesheets", {
  id: text("id").primaryKey(),
  employeeId: text("employee_id").notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  totalAttendance: doublePrecision("total_attendance"),
  totalTimesheet: doublePrecision("total_timesheet"),
  status: text("status").notNull(),
  validatedBy: text("validated_by"),
});

export const serviceBookEntries = gapmc.table("service_book_entries", {
  id: text("id").primaryKey(),
  employeeId: text("employee_id").notNull(),
  section: text("section").notNull(), // Appendix | AuditComments | Verification | History | CertMutable | CertImmutable
  content: jsonb("content").notNull(),
  isImmutable: boolean("is_immutable").default(false),
  status: text("status").notNull(),
  approvedBy: text("approved_by"),
  approvedAt: text("approved_at"),
});

export const leaveRequests = gapmc.table("leave_requests", {
  id: text("id").primaryKey(),
  employeeId: text("employee_id").notNull(),
  leaveType: text("leave_type").notNull(),
  fromDate: text("from_date").notNull(),
  toDate: text("to_date").notNull(),
  status: text("status").notNull(), // Pending | Verified | Approved | Rejected
  doUser: text("do_user"),
  dvUser: text("dv_user"),
  approvedBy: text("approved_by"),
  rejectionReasonCode: text("rejection_reason_code"),
  rejectionRemarks: text("rejection_remarks"),
  workflowRevisionCount: integer("workflow_revision_count").default(0),
  dvReturnRemarks: text("dv_return_remarks"),
});

export const ltcClaims = gapmc.table("ltc_claims", {
  id: text("id").primaryKey(),
  employeeId: text("employee_id").notNull(),
  claimDate: text("claim_date").notNull(),
  amount: doublePrecision("amount").notNull(),
  period: text("period"),
  status: text("status").notNull(),
});

export const taDaClaims = gapmc.table("ta_da_claims", {
  id: text("id").primaryKey(),
  employeeId: text("employee_id").notNull(),
  travelDate: text("travel_date").notNull(),
  purpose: text("purpose").notNull(),
  amount: doublePrecision("amount").notNull(),
  status: text("status").notNull(),
});

// ----- M-02: Trader & Asset ID Management -----
export const traderLicences = gapmc.table("trader_licences", {
  id: text("id").primaryKey(),
  licenceNo: text("licence_no").unique(),
  firmName: text("firm_name").notNull(),
  firmType: text("firm_type"),
  yardId: text("yard_id").notNull(),
  contactName: text("contact_name"),
  mobile: text("mobile").notNull(),
  email: text("email"),
  address: text("address"),
  aadhaarToken: text("aadhaar_token"),
  pan: text("pan"),
  gstin: text("gstin"),
  licenceType: text("licence_type").notNull(), // Associated | Functionary | Hamali | Weighman | AssistantTrader
  feeAmount: doublePrecision("fee_amount"),
  receiptId: text("receipt_id"),
  validFrom: text("valid_from"),
  validTo: text("valid_to"),
  status: text("status").notNull(), // Draft | Pending | Active | Expired | Blocked | Rejected
  isBlocked: boolean("is_blocked").default(false),
  blockReason: text("block_reason"),
  doUser: text("do_user"),
  dvUser: text("dv_user"),
  daUser: text("da_user"),
  /** When set, tenant is a listed govt. office/godown holder — GST not charged (M-03/M-05). */
  govtGstExemptCategoryId: text("govt_gst_exempt_category_id"),
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
});

export const assistantTraders = gapmc.table("assistant_traders", {
  id: text("id").primaryKey(),
  primaryLicenceId: text("primary_licence_id").notNull(),
  personName: text("person_name").notNull(),
  characterCertIssuer: text("character_cert_issuer"),
  certDate: text("cert_date"),
  manualLicenceNo: text("manual_licence_no"),
  status: text("status").notNull(),
  yardId: text("yard_id").notNull(),
});

export const assets = gapmc.table("assets", {
  id: text("id").primaryKey(),
  assetId: text("asset_id").notNull().unique(), // [LOC]/[TYPE]-[NNN]
  yardId: text("yard_id").notNull(),
  assetType: text("asset_type").notNull(), // Shop | Godown | Office | Building
  complexName: text("complex_name"),
  area: text("area"),
  plinthAreaSqft: doublePrecision("plinth_area_sqft"),
  value: doublePrecision("value"),
  fileNumber: text("file_number"),
  orderNumber: text("order_number"),
  isActive: boolean("is_active").default(true),
});

export const assetAllotments = gapmc.table("asset_allotments", {
  id: text("id").primaryKey(),
  assetId: text("asset_id").notNull(),
  traderLicenceId: text("trader_licence_id").notNull(),
  allotteeName: text("allottee_name").notNull(),
  fromDate: text("from_date").notNull(),
  toDate: text("to_date").notNull(),
  status: text("status").notNull(), // Active | Vacated
  securityDeposit: doublePrecision("security_deposit"),
  doUser: text("do_user"),
  daUser: text("da_user"),
});

export const traderBlockingLog = gapmc.table("trader_blocking_log", {
  id: text("id").primaryKey(),
  traderLicenceId: text("trader_licence_id").notNull(),
  action: text("action").notNull(), // Blocked | Unblocked
  reason: text("reason").notNull(),
  actionedBy: text("actioned_by").notNull(),
  actionedAt: text("actioned_at").notNull(),
});

export const mspSettings = gapmc.table("msp_settings", {
  id: text("id").primaryKey(),
  commodity: text("commodity").notNull(),
  mspRate: doublePrecision("msp_rate").notNull(),
  validFrom: text("valid_from").notNull(),
  validTo: text("valid_to").notNull(),
  updatedBy: text("updated_by"),
});

// ----- M-03: Rent / GST Tax Invoice -----
export const rentInvoices = gapmc.table("rent_invoices", {
  id: text("id").primaryKey(),
  invoiceNo: text("invoice_no").unique(),
  allotmentId: text("allotment_id").notNull(),
  tenantLicenceId: text("tenant_licence_id").notNull(),
  assetId: text("asset_id").notNull(),
  yardId: text("yard_id").notNull(),
  periodMonth: text("period_month").notNull(),
  rentAmount: doublePrecision("rent_amount").notNull(),
  cgst: doublePrecision("cgst").notNull(),
  sgst: doublePrecision("sgst").notNull(),
  totalAmount: doublePrecision("total_amount").notNull(),
  isGovtEntity: boolean("is_govt_entity").default(false),
  status: text("status").notNull(), // Draft | Verified | Approved | Paid | Cancelled
  doUser: text("do_user"),
  dvUser: text("dv_user"),
  daUser: text("da_user"),
  generatedAt: text("generated_at"),
  approvedAt: text("approved_at"),
  workflowRevisionCount: integer("workflow_revision_count").default(0),
  dvReturnRemarks: text("dv_return_remarks"),
});

export const rentDepositLedger = gapmc.table("rent_deposit_ledger", {
  id: text("id").primaryKey(),
  tenantLicenceId: text("tenant_licence_id").notNull(),
  assetId: text("asset_id").notNull(),
  entryDate: text("entry_date").notNull(),
  entryType: text("entry_type").notNull(), // OpeningBalance | Rent | Interest | CGST | SGST | Collection
  debit: doublePrecision("debit").default(0),
  credit: doublePrecision("credit").default(0),
  balance: doublePrecision("balance").notNull(),
  invoiceId: text("invoice_id"),
  receiptId: text("receipt_id"),
});

export const creditNotes = gapmc.table("credit_notes", {
  id: text("id").primaryKey(),
  creditNoteNo: text("credit_note_no").notNull().unique(),
  invoiceId: text("invoice_id").notNull(),
  reason: text("reason").notNull(),
  amount: doublePrecision("amount").notNull(),
  status: text("status").notNull(), // Draft | Approved
  daUser: text("da_user"),
  approvedAt: text("approved_at"),
});

// ----- M-04: Market Fee & Commodities -----
export const commodities = gapmc.table("commodities", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  variety: text("variety"),
  unit: text("unit"),
  gradeType: text("grade_type"),
  isActive: boolean("is_active").default(true),
});

export const marketFeeRates = gapmc.table("market_fee_rates", {
  id: text("id").primaryKey(),
  commodityId: text("commodity_id").notNull(),
  feePercent: doublePrecision("fee_percent").default(1),
  validFrom: text("valid_from").notNull(),
  validTo: text("valid_to").notNull(),
  yardId: text("yard_id"),
});

export const farmers = gapmc.table("farmers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  village: text("village"),
  taluk: text("taluk"),
  district: text("district"),
  mobile: text("mobile"),
  aadhaarToken: text("aadhaar_token"),
  yardId: text("yard_id").notNull(),
});

export const purchaseTransactions = gapmc.table("purchase_transactions", {
  id: text("id").primaryKey(),
  transactionNo: text("transaction_no").unique(),
  yardId: text("yard_id").notNull(),
  commodityId: text("commodity_id").notNull(),
  farmerId: text("farmer_id"),
  traderLicenceId: text("trader_licence_id").notNull(),
  quantity: doublePrecision("quantity").notNull(),
  unit: text("unit").notNull(),
  weight: doublePrecision("weight"),
  declaredValue: doublePrecision("declared_value").notNull(),
  marketFeePercent: doublePrecision("market_fee_percent").notNull(),
  marketFeeAmount: doublePrecision("market_fee_amount").notNull(),
  purchaseType: text("purchase_type").notNull(),
  grade: text("grade"),
  transactionDate: text("transaction_date").notNull(),
  status: text("status").notNull(),
  receiptId: text("receipt_id"),
  doUser: text("do_user"),
  dvUser: text("dv_user"),
  daUser: text("da_user"),
  workflowRevisionCount: integer("workflow_revision_count").default(0),
  dvReturnRemarks: text("dv_return_remarks"),
  /** M-04 adjusted return: links to an Approved original purchase row. */
  parentTransactionId: text("parent_transaction_id"),
  entryKind: text("entry_kind").notNull().default("Original"), // Original | Adjustment
});

export const checkPostInward = gapmc.table("check_post_inward", {
  id: text("id").primaryKey(),
  entryNo: text("entry_no").unique(),
  checkPostId: text("check_post_id").notNull(),
  traderLicenceId: text("trader_licence_id"),
  invoiceNumber: text("invoice_number"),
  vehicleNumber: text("vehicle_number"),
  transactionType: text("transaction_type").notNull(), // Permanent | Passway/Transit | Temporary | Prepaid | Advance
  fromFirm: text("from_firm"),
  toFirm: text("to_firm"),
  fromState: text("from_state"),
  toState: text("to_state"),
  totalCharges: doublePrecision("total_charges"),
  encodedData: text("encoded_data"),
  entryDate: text("entry_date").notNull(),
  officerId: text("officer_id"),
  status: text("status").notNull(), // Draft | Verified
});

export const checkPostInwardCommodities = gapmc.table("check_post_inward_commodities", {
  id: text("id").primaryKey(),
  inwardId: text("inward_id").notNull(),
  commodityId: text("commodity_id").notNull(),
  unit: text("unit").notNull(),
  quantity: doublePrecision("quantity").notNull(),
  value: doublePrecision("value").notNull(),
  marketFeePercent: doublePrecision("market_fee_percent"),
  marketFeeAmount: doublePrecision("market_fee_amount"),
});

export const checkPostOutward = gapmc.table("check_post_outward", {
  id: text("id").primaryKey(),
  entryNo: text("entry_no").unique(),
  checkPostId: text("check_post_id").notNull(),
  inwardRefId: text("inward_ref_id").notNull(),
  vehicleNumber: text("vehicle_number"),
  receiptNumber: text("receipt_number"),
  entryDate: text("entry_date").notNull(),
});

export const exitPermits = gapmc.table("exit_permits", {
  id: text("id").primaryKey(),
  permitNo: text("permit_no").notNull().unique(),
  inwardId: text("inward_id").notNull(),
  issuedDate: text("issued_date").notNull(),
  officerId: text("officer_id").notNull(),
});

export const checkPostBankDeposits = gapmc.table("check_post_bank_deposits", {
  id: text("id").primaryKey(),
  checkPostId: text("check_post_id").notNull(),
  depositDate: text("deposit_date").notNull(),
  bankName: text("bank_name").notNull(),
  accountNumber: text("account_number"),
  amount: doublePrecision("amount").notNull(),
  voucherDetails: text("voucher_details"),
  narration: text("narration"),
  status: text("status").notNull(), // Recorded | Verified
  verifiedBy: text("verified_by"),
});

// ----- M-06: Payment Voucher Management -----
export const expenditureHeads = gapmc.table("expenditure_heads", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  description: text("description").notNull(),
  category: text("category"),
  tallyLedgerId: text("tally_ledger_id"),
  isActive: boolean("is_active").default(true),
});

export const paymentVouchers = gapmc.table("payment_vouchers", {
  id: text("id").primaryKey(),
  voucherNo: text("voucher_no").unique(),
  voucherType: text("voucher_type").notNull(), // Salary | ContractorBill | OperationalExpense | AdvanceRequest | Refund
  yardId: text("yard_id").notNull(),
  expenditureHeadId: text("expenditure_head_id").notNull(),
  payeeName: text("payee_name").notNull(),
  payeeAccount: text("payee_account"),
  payeeBank: text("payee_bank"),
  amount: doublePrecision("amount").notNull(),
  description: text("description"),
  sourceModule: text("source_module"), // M-07 | M-08 | M-01
  sourceRecordId: text("source_record_id"),
  supportingDocs: jsonb("supporting_docs").$type<string[]>(),
  status: text("status").notNull(), // Draft | Submitted | Verified | Approved | Paid | Rejected
  doUser: text("do_user"),
  dvUser: text("dv_user"),
  daUser: text("da_user"),
  paidAt: text("paid_at"),
  paymentRef: text("payment_ref"),
  createdAt: text("created_at"),
  rejectionReasonCode: text("rejection_reason_code"),
  rejectionRemarks: text("rejection_remarks"),
  workflowRevisionCount: integer("workflow_revision_count").default(0),
  dvReturnRemarks: text("dv_return_remarks"),
});

export const advanceRequests = gapmc.table("advance_requests", {
  id: text("id").primaryKey(),
  voucherId: text("voucher_id").notNull(),
  employeeId: text("employee_id").notNull(),
  purpose: text("purpose").notNull(),
  amount: doublePrecision("amount").notNull(),
  recoverySchedule: text("recovery_schedule"),
  recoveredAmount: doublePrecision("recovered_amount").default(0),
});

// ----- M-07: Vehicle Fleet Management -----
export const vehicles = gapmc.table("vehicles", {
  id: text("id").primaryKey(),
  registrationNo: text("registration_no").notNull().unique(),
  vehicleType: text("vehicle_type").notNull(),
  capacity: text("capacity"),
  yardId: text("yard_id").notNull(),
  purchaseDate: text("purchase_date"),
  purchaseValue: doublePrecision("purchase_value"),
  insuranceExpiry: text("insurance_expiry"),
  fitnessExpiry: text("fitness_expiry"),
  status: text("status").notNull(), // Active | UnderRepair | Decommissioned
  doUser: text("do_user"),
  daUser: text("da_user"),
});

export const vehicleTripLog = gapmc.table("vehicle_trip_log", {
  id: text("id").primaryKey(),
  vehicleId: text("vehicle_id").notNull(),
  driverId: text("driver_id"),
  tripDate: text("trip_date").notNull(),
  purpose: text("purpose"),
  route: text("route"),
  odometerStart: doublePrecision("odometer_start"),
  odometerEnd: doublePrecision("odometer_end"),
  distanceKm: doublePrecision("distance_km"),
  fuelConsumed: doublePrecision("fuel_consumed"),
  officerId: text("officer_id"),
});

export const vehicleFuelRegister = gapmc.table("vehicle_fuel_register", {
  id: text("id").primaryKey(),
  vehicleId: text("vehicle_id").notNull(),
  fuelDate: text("fuel_date").notNull(),
  quantityLitres: doublePrecision("quantity_litres").notNull(),
  ratePerLitre: doublePrecision("rate_per_litre"),
  totalAmount: doublePrecision("total_amount"),
  voucherId: text("voucher_id"),
  officerId: text("officer_id"),
});

export const vehicleMaintenance = gapmc.table("vehicle_maintenance", {
  id: text("id").primaryKey(),
  vehicleId: text("vehicle_id").notNull(),
  maintenanceType: text("maintenance_type").notNull(), // Scheduled | Repair | Inspection
  serviceDate: text("service_date").notNull(),
  description: text("description"),
  cost: doublePrecision("cost"),
  vendorName: text("vendor_name"),
  voucherId: text("voucher_id"),
  nextServiceDate: text("next_service_date"),
  officerId: text("officer_id"),
});

// ----- M-08: Construction & Maintenance -----
export const works = gapmc.table("works", {
  id: text("id").primaryKey(),
  workNo: text("work_no").unique(),
  yardId: text("yard_id").notNull(),
  workType: text("work_type").notNull(),
  description: text("description"),
  location: text("location"),
  contractorName: text("contractor_name"),
  contractorContact: text("contractor_contact"),
  estimateAmount: doublePrecision("estimate_amount"),
  tenderValue: doublePrecision("tender_value"),
  workOrderNo: text("work_order_no"),
  workOrderDate: text("work_order_date"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  completionDate: text("completion_date"),
  status: text("status").notNull(), // Planned | InProgress | Completed | Closed
  doUser: text("do_user"),
  dvUser: text("dv_user"),
  daUser: text("da_user"),
});

export const worksBills = gapmc.table("works_bills", {
  id: text("id").primaryKey(),
  workId: text("work_id").notNull(),
  billNo: text("bill_no"),
  billDate: text("bill_date").notNull(),
  amount: doublePrecision("amount").notNull(),
  cumulativePaid: doublePrecision("cumulative_paid").default(0),
  voucherId: text("voucher_id"),
  status: text("status").notNull(),
  approvedBy: text("approved_by"),
});

export const amcContracts = gapmc.table("amc_contracts", {
  id: text("id").primaryKey(),
  yardId: text("yard_id").notNull(),
  contractorName: text("contractor_name").notNull(),
  description: text("description"),
  amountPerPeriod: doublePrecision("amount_per_period").notNull(),
  periodType: text("period_type"), // Monthly | Quarterly | Annual
  contractStart: text("contract_start").notNull(),
  contractEnd: text("contract_end").notNull(),
  status: text("status").notNull(), // Active | Expired | Renewed
  daUser: text("da_user"),
});

export const amcBills = gapmc.table("amc_bills", {
  id: text("id").primaryKey(),
  amcId: text("amc_id").notNull(),
  billDate: text("bill_date").notNull(),
  amount: doublePrecision("amount").notNull(),
  voucherId: text("voucher_id"),
});

export const landRecords = gapmc.table("land_records", {
  id: text("id").primaryKey(),
  yardId: text("yard_id").notNull(),
  surveyNo: text("survey_no").notNull(),
  village: text("village"),
  taluk: text("taluk"),
  district: text("district"),
  areaSqm: doublePrecision("area_sqm"),
  saleDeedNo: text("sale_deed_no"),
  saleDeedDate: text("sale_deed_date"),
  encumbrance: text("encumbrance"),
  remarks: text("remarks"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
});

export const fixedAssets = gapmc.table("fixed_assets", {
  id: text("id").primaryKey(),
  yardId: text("yard_id").notNull(),
  assetType: text("asset_type").notNull(),
  description: text("description"),
  acquisitionDate: text("acquisition_date").notNull(),
  acquisitionValue: doublePrecision("acquisition_value").notNull(),
  usefulLifeYears: integer("useful_life_years"),
  depreciationMethod: text("depreciation_method"),
  currentBookValue: doublePrecision("current_book_value"),
  disposalDate: text("disposal_date"),
  disposalValue: doublePrecision("disposal_value"),
  disposalApprovedBy: text("disposal_approved_by"),
  worksId: text("works_id"),
  status: text("status").notNull(), // Active | Disposed
});

// ----- M-09: Correspondence Management -----
export const dakInward = gapmc.table("dak_inward", {
  id: text("id").primaryKey(),
  yardId: text("yard_id"), // optional; when set, scoped by user's yards
  diaryNo: text("diary_no").unique(),
  receivedDate: text("received_date").notNull(),
  fromParty: text("from_party").notNull(),
  fromAddress: text("from_address"),
  subject: text("subject").notNull(),
  modeOfReceipt: text("mode_of_receipt").notNull(), // Hand | Post | Courier | Email | Fax
  receivedBy: text("received_by"),
  assignedTo: text("assigned_to"),
  deadline: text("deadline"),
  fileRef: text("file_ref"),
  status: text("status").notNull(), // Pending | InProgress | Closed
  createdAt: text("created_at"),
});

export const dakOutward = gapmc.table("dak_outward", {
  id: text("id").primaryKey(),
  yardId: text("yard_id"), // optional; when set, scoped by user's yards
  despatchNo: text("despatch_no").unique(),
  despatchDate: text("despatch_date").notNull(),
  toParty: text("to_party").notNull(),
  toAddress: text("to_address"),
  subject: text("subject").notNull(),
  modeOfDespatch: text("mode_of_despatch").notNull(),
  inwardRefId: text("inward_ref_id"),
  fileRef: text("file_ref"),
  despatchedBy: text("despatched_by"),
  createdAt: text("created_at"),
});

export const dakActionLog = gapmc.table("dak_action_log", {
  id: text("id").primaryKey(),
  inwardId: text("inward_id").notNull(),
  actionBy: text("action_by").notNull(),
  actionDate: text("action_date").notNull(),
  actionNote: text("action_note"),
  statusAfter: text("status_after"),
});

export const dakEscalations = gapmc.table("dak_escalations", {
  id: text("id").primaryKey(),
  inwardId: text("inward_id").notNull(),
  escalatedTo: text("escalated_to").notNull(),
  escalationReason: text("escalation_reason"),
  escalatedAt: text("escalated_at").notNull(),
  resolvedAt: text("resolved_at"),
});

// ----- Bug tracking (all authenticated users may report; ADMIN manages lifecycle) -----
export const bugTicketSeq = gapmc.table("bug_ticket_seq", {
  year: text("year").primaryKey(),
  lastSeq: integer("last_seq").notNull().default(0),
});

export const bugTickets = gapmc.table("bug_tickets", {
  id: text("id").primaryKey(),
  ticketNo: text("ticket_no").notNull().unique(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  bugType: text("bug_type").notNull(),
  bugSubtype: text("bug_subtype").notNull(),
  severity: text("severity").notNull(), // low | medium | high | critical
  status: text("status").notNull(), // open | in_progress | resolved | closed
  reporterUserId: text("reporter_user_id").notNull(),
  assignedToUserId: text("assigned_to_user_id"),
  resolutionSummary: text("resolution_summary"),
  closedByUserId: text("closed_by_user_id"),
  resolvedAt: text("resolved_at"),
  closedAt: text("closed_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const bugAttachments = gapmc.table("bug_attachments", {
  id: text("id").primaryKey(),
  bugTicketId: text("bug_ticket_id").notNull(),
  uploadedByUserId: text("uploaded_by_user_id").notNull(),
  originalFilename: text("original_filename").notNull(),
  storedFilename: text("stored_filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: text("created_at").notNull(),
});

export const bugComments = gapmc.table("bug_comments", {
  id: text("id").primaryKey(),
  bugTicketId: text("bug_ticket_id").notNull(),
  userId: text("user_id").notNull(),
  body: text("body").notNull(),
  createdAt: text("created_at").notNull(),
});
