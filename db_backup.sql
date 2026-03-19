-- GAPMC Database Schema Backup (DDL only)
-- Source: shared/db-schema.ts (Drizzle ORM)
-- Schema: gapmc (PostgreSQL)
-- Generated: 2025-02-26

-- Create schema
CREATE SCHEMA IF NOT EXISTS gapmc;

-- ============== Original GAPMC Tables ==============

CREATE TABLE IF NOT EXISTS gapmc.traders (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  name TEXT NOT NULL,
  firm_name TEXT,
  type TEXT NOT NULL,
  mobile TEXT NOT NULL,
  phone TEXT,
  email TEXT NOT NULL,
  residential_address TEXT,
  business_address TEXT,
  aadhaar TEXT NOT NULL,
  pan TEXT NOT NULL,
  gst TEXT,
  epic_voter_id TEXT,
  bank_name TEXT,
  account_number TEXT,
  ifsc_code TEXT,
  branch_name TEXT,
  yard_id INTEGER NOT NULL,
  yard_name TEXT NOT NULL,
  premises TEXT NOT NULL,
  premises_type TEXT NOT NULL,
  registration_type TEXT NOT NULL,
  commodities JSONB NOT NULL,
  status TEXT NOT NULL,
  agreement_start TEXT,
  agreement_end TEXT,
  rent_amount DOUBLE PRECISION NOT NULL,
  security_deposit DOUBLE PRECISION NOT NULL,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.invoices (
  id TEXT PRIMARY KEY,
  trader_id TEXT NOT NULL,
  trader_name TEXT NOT NULL,
  premises TEXT NOT NULL,
  yard TEXT NOT NULL,
  yard_id INTEGER NOT NULL,
  month TEXT NOT NULL,
  invoice_date TEXT NOT NULL,
  base_rent DOUBLE PRECISION NOT NULL,
  cgst DOUBLE PRECISION NOT NULL,
  sgst DOUBLE PRECISION NOT NULL,
  interest DOUBLE PRECISION NOT NULL,
  total DOUBLE PRECISION NOT NULL,
  tds_applicable BOOLEAN NOT NULL,
  tds_amount DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.receipts (
  id TEXT PRIMARY KEY,
  receipt_no TEXT NOT NULL,
  receipt_date TEXT NOT NULL,
  type TEXT NOT NULL,
  trader_id TEXT NOT NULL,
  trader_name TEXT NOT NULL,
  head TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  cgst DOUBLE PRECISION,
  sgst DOUBLE PRECISION,
  interest DOUBLE PRECISION,
  security_deposit DOUBLE PRECISION,
  tds_amount DOUBLE PRECISION,
  total DOUBLE PRECISION NOT NULL,
  payment_mode TEXT NOT NULL,
  cheque_no TEXT,
  cheque_bank TEXT,
  cheque_date TEXT,
  transaction_ref TEXT,
  narration TEXT,
  yard_id INTEGER NOT NULL,
  yard_name TEXT NOT NULL,
  issued_by TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.market_fees (
  id TEXT PRIMARY KEY,
  receipt_no TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  entry_type TEXT NOT NULL,
  trader_id TEXT NOT NULL,
  trader_name TEXT NOT NULL,
  license_no TEXT NOT NULL,
  address TEXT,
  gst_pan TEXT,
  commodity TEXT NOT NULL,
  commodity_type TEXT NOT NULL,
  quantity DOUBLE PRECISION NOT NULL,
  unit TEXT NOT NULL,
  rate_per_unit DOUBLE PRECISION NOT NULL,
  total_value DOUBLE PRECISION NOT NULL,
  market_fee DOUBLE PRECISION NOT NULL,
  vehicle_type TEXT NOT NULL,
  vehicle_number TEXT NOT NULL,
  location_id INTEGER NOT NULL,
  location_name TEXT NOT NULL,
  payment_mode TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.agreements (
  id TEXT PRIMARY KEY,
  agreement_id TEXT NOT NULL,
  trader_id TEXT NOT NULL,
  trader_name TEXT NOT NULL,
  premises TEXT NOT NULL,
  yard_id INTEGER NOT NULL,
  yard_name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  rent_amount DOUBLE PRECISION NOT NULL,
  security_deposit DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.stock_returns (
  id TEXT PRIMARY KEY,
  trader_id TEXT NOT NULL,
  trader_name TEXT NOT NULL,
  period TEXT NOT NULL,
  commodity TEXT NOT NULL,
  opening_balance DOUBLE PRECISION NOT NULL,
  locally_procured DOUBLE PRECISION NOT NULL,
  purchased_from_trader DOUBLE PRECISION NOT NULL,
  sales DOUBLE PRECISION NOT NULL,
  closing_balance DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.activity_logs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  module TEXT NOT NULL,
  "user" TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  details TEXT
);

-- ============== IOMS M-10: RBAC & System Administration ==============

CREATE TABLE IF NOT EXISTS gapmc.yards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  phone TEXT,
  mobile TEXT,
  address TEXT,
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS gapmc.users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  employee_id TEXT,
  password_hash TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.user_roles (
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS gapmc.permissions (
  id TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  action TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gapmc.role_permissions (
  role_id TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS gapmc.user_yards (
  user_id TEXT NOT NULL,
  yard_id TEXT NOT NULL,
  PRIMARY KEY (user_id, yard_id)
);

CREATE TABLE IF NOT EXISTS gapmc.system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.sla_config (
  id TEXT PRIMARY KEY,
  workflow TEXT NOT NULL,
  hours INTEGER NOT NULL,
  alert_role TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  module TEXT NOT NULL,
  action TEXT NOT NULL,
  record_id TEXT,
  before_value JSONB,
  after_value JSONB,
  ip TEXT,
  created_at TEXT NOT NULL
);

-- ============== IOMS M-05: Receipts Online ==============

CREATE TABLE IF NOT EXISTS gapmc.receipt_sequence (
  yard_id TEXT NOT NULL,
  revenue_head TEXT NOT NULL,
  financial_year TEXT NOT NULL,
  last_seq INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (yard_id, revenue_head, financial_year)
);

CREATE TABLE IF NOT EXISTS gapmc.payment_gateway_log (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL,
  gateway TEXT NOT NULL,
  gateway_txn_id TEXT,
  status TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  gateway_response JSONB,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gapmc.ioms_receipts (
  id TEXT PRIMARY KEY,
  receipt_no TEXT NOT NULL UNIQUE,
  yard_id TEXT NOT NULL,
  revenue_head TEXT NOT NULL,
  payer_name TEXT,
  payer_type TEXT,
  payer_ref_id TEXT,
  amount DOUBLE PRECISION NOT NULL,
  cgst DOUBLE PRECISION DEFAULT 0,
  sgst DOUBLE PRECISION DEFAULT 0,
  total_amount DOUBLE PRECISION NOT NULL,
  payment_mode TEXT NOT NULL,
  gateway_ref TEXT,
  cheque_no TEXT,
  bank_name TEXT,
  cheque_date TEXT,
  source_module TEXT,
  source_record_id TEXT,
  qr_code_url TEXT,
  pdf_url TEXT,
  status TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- ============== IOMS M-01: HRMS & Service Record ==============

CREATE TABLE IF NOT EXISTS gapmc.employees (
  id TEXT PRIMARY KEY,
  emp_id TEXT UNIQUE,
  first_name TEXT NOT NULL,
  middle_name TEXT,
  surname TEXT NOT NULL,
  photo_url TEXT,
  designation TEXT NOT NULL,
  yard_id TEXT NOT NULL,
  employee_type TEXT NOT NULL,
  aadhaar_token TEXT,
  pan TEXT,
  dob TEXT,
  joining_date TEXT NOT NULL,
  retirement_date TEXT,
  mobile TEXT,
  work_email TEXT,
  status TEXT NOT NULL,
  user_id TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.employee_contracts (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  contract_type TEXT NOT NULL,
  pay_scale TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.recruitment (
  id TEXT PRIMARY KEY,
  position TEXT NOT NULL,
  applicant_name TEXT NOT NULL,
  qualification TEXT,
  applied_date TEXT NOT NULL,
  status TEXT NOT NULL,
  interview_outcomes JSONB,
  decision TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.attendances (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  date TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.timesheets (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  total_attendance DOUBLE PRECISION,
  total_timesheet DOUBLE PRECISION,
  status TEXT NOT NULL,
  validated_by TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.service_book_entries (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  section TEXT NOT NULL,
  content JSONB NOT NULL,
  is_immutable BOOLEAN DEFAULT false,
  status TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.leave_requests (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  leave_type TEXT NOT NULL,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  status TEXT NOT NULL,
  approved_by TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.ltc_claims (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  claim_date TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  period TEXT,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gapmc.ta_da_claims (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  travel_date TEXT NOT NULL,
  purpose TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL
);

-- ============== IOMS M-02: Trader & Asset ID Management ==============

CREATE TABLE IF NOT EXISTS gapmc.trader_licences (
  id TEXT PRIMARY KEY,
  licence_no TEXT UNIQUE,
  firm_name TEXT NOT NULL,
  firm_type TEXT,
  yard_id TEXT NOT NULL,
  contact_name TEXT,
  mobile TEXT NOT NULL,
  email TEXT,
  address TEXT,
  aadhaar_token TEXT,
  pan TEXT,
  gstin TEXT,
  licence_type TEXT NOT NULL,
  fee_amount DOUBLE PRECISION,
  receipt_id TEXT,
  valid_from TEXT,
  valid_to TEXT,
  status TEXT NOT NULL,
  is_blocked BOOLEAN DEFAULT false,
  block_reason TEXT,
  do_user TEXT,
  dv_user TEXT,
  da_user TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.assistant_traders (
  id TEXT PRIMARY KEY,
  primary_licence_id TEXT NOT NULL,
  person_name TEXT NOT NULL,
  character_cert_issuer TEXT,
  cert_date TEXT,
  manual_licence_no TEXT,
  status TEXT NOT NULL,
  yard_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gapmc.assets (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL UNIQUE,
  yard_id TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  complex_name TEXT,
  area TEXT,
  plinth_area_sqft DOUBLE PRECISION,
  value DOUBLE PRECISION,
  file_number TEXT,
  order_number TEXT,
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS gapmc.asset_allotments (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  trader_licence_id TEXT NOT NULL,
  allottee_name TEXT NOT NULL,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  status TEXT NOT NULL,
  security_deposit DOUBLE PRECISION,
  do_user TEXT,
  da_user TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.trader_blocking_log (
  id TEXT PRIMARY KEY,
  trader_licence_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  actioned_by TEXT NOT NULL,
  actioned_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gapmc.msp_settings (
  id TEXT PRIMARY KEY,
  commodity TEXT NOT NULL,
  msp_rate DOUBLE PRECISION NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT NOT NULL,
  updated_by TEXT
);

-- ============== IOMS M-03: Rent / GST Tax Invoice ==============

CREATE TABLE IF NOT EXISTS gapmc.rent_invoices (
  id TEXT PRIMARY KEY,
  invoice_no TEXT UNIQUE,
  allotment_id TEXT NOT NULL,
  tenant_licence_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  yard_id TEXT NOT NULL,
  period_month TEXT NOT NULL,
  rent_amount DOUBLE PRECISION NOT NULL,
  cgst DOUBLE PRECISION NOT NULL,
  sgst DOUBLE PRECISION NOT NULL,
  total_amount DOUBLE PRECISION NOT NULL,
  is_govt_entity BOOLEAN DEFAULT false,
  status TEXT NOT NULL,
  do_user TEXT,
  dv_user TEXT,
  da_user TEXT,
  generated_at TEXT,
  approved_at TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.rent_deposit_ledger (
  id TEXT PRIMARY KEY,
  tenant_licence_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  entry_type TEXT NOT NULL,
  debit DOUBLE PRECISION DEFAULT 0,
  credit DOUBLE PRECISION DEFAULT 0,
  balance DOUBLE PRECISION NOT NULL,
  invoice_id TEXT,
  receipt_id TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.credit_notes (
  id TEXT PRIMARY KEY,
  credit_note_no TEXT NOT NULL UNIQUE,
  invoice_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL,
  da_user TEXT,
  approved_at TEXT
);

-- ============== IOMS M-04: Market Fee & Commodities ==============

CREATE TABLE IF NOT EXISTS gapmc.commodities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  variety TEXT,
  unit TEXT,
  grade_type TEXT,
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS gapmc.market_fee_rates (
  id TEXT PRIMARY KEY,
  commodity_id TEXT NOT NULL,
  fee_percent DOUBLE PRECISION DEFAULT 1,
  valid_from TEXT NOT NULL,
  valid_to TEXT NOT NULL,
  yard_id TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.farmers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  village TEXT,
  taluk TEXT,
  district TEXT,
  mobile TEXT,
  aadhaar_token TEXT,
  yard_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gapmc.purchase_transactions (
  id TEXT PRIMARY KEY,
  transaction_no TEXT UNIQUE,
  yard_id TEXT NOT NULL,
  commodity_id TEXT NOT NULL,
  farmer_id TEXT,
  trader_licence_id TEXT NOT NULL,
  quantity DOUBLE PRECISION NOT NULL,
  unit TEXT NOT NULL,
  weight DOUBLE PRECISION,
  declared_value DOUBLE PRECISION NOT NULL,
  market_fee_percent DOUBLE PRECISION NOT NULL,
  market_fee_amount DOUBLE PRECISION NOT NULL,
  purchase_type TEXT NOT NULL,
  grade TEXT,
  transaction_date TEXT NOT NULL,
  status TEXT NOT NULL,
  receipt_id TEXT,
  do_user TEXT,
  dv_user TEXT,
  da_user TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.check_post_inward (
  id TEXT PRIMARY KEY,
  entry_no TEXT UNIQUE,
  check_post_id TEXT NOT NULL,
  trader_licence_id TEXT,
  invoice_number TEXT,
  vehicle_number TEXT,
  transaction_type TEXT NOT NULL,
  from_firm TEXT,
  to_firm TEXT,
  from_state TEXT,
  to_state TEXT,
  total_charges DOUBLE PRECISION,
  encoded_data TEXT,
  entry_date TEXT NOT NULL,
  officer_id TEXT,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gapmc.check_post_inward_commodities (
  id TEXT PRIMARY KEY,
  inward_id TEXT NOT NULL,
  commodity_id TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity DOUBLE PRECISION NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  market_fee_percent DOUBLE PRECISION,
  market_fee_amount DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS gapmc.check_post_outward (
  id TEXT PRIMARY KEY,
  entry_no TEXT UNIQUE,
  check_post_id TEXT NOT NULL,
  inward_ref_id TEXT NOT NULL,
  vehicle_number TEXT,
  receipt_number TEXT,
  entry_date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gapmc.exit_permits (
  id TEXT PRIMARY KEY,
  permit_no TEXT NOT NULL UNIQUE,
  inward_id TEXT NOT NULL,
  issued_date TEXT NOT NULL,
  officer_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gapmc.check_post_bank_deposits (
  id TEXT PRIMARY KEY,
  check_post_id TEXT NOT NULL,
  deposit_date TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  account_number TEXT,
  amount DOUBLE PRECISION NOT NULL,
  voucher_details TEXT,
  narration TEXT,
  status TEXT NOT NULL,
  verified_by TEXT
);

-- ============== IOMS M-06: Payment Voucher Management ==============

CREATE TABLE IF NOT EXISTS gapmc.expenditure_heads (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  category TEXT,
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS gapmc.payment_vouchers (
  id TEXT PRIMARY KEY,
  voucher_no TEXT UNIQUE,
  voucher_type TEXT NOT NULL,
  yard_id TEXT NOT NULL,
  expenditure_head_id TEXT NOT NULL,
  payee_name TEXT NOT NULL,
  payee_account TEXT,
  payee_bank TEXT,
  amount DOUBLE PRECISION NOT NULL,
  description TEXT,
  source_module TEXT,
  source_record_id TEXT,
  supporting_docs JSONB,
  status TEXT NOT NULL,
  do_user TEXT,
  dv_user TEXT,
  da_user TEXT,
  paid_at TEXT,
  payment_ref TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.advance_requests (
  id TEXT PRIMARY KEY,
  voucher_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  recovery_schedule TEXT,
  recovered_amount DOUBLE PRECISION DEFAULT 0
);

-- ============== IOMS M-07: Vehicle Fleet Management ==============

CREATE TABLE IF NOT EXISTS gapmc.vehicles (
  id TEXT PRIMARY KEY,
  registration_no TEXT NOT NULL UNIQUE,
  vehicle_type TEXT NOT NULL,
  capacity TEXT,
  yard_id TEXT NOT NULL,
  purchase_date TEXT,
  purchase_value DOUBLE PRECISION,
  insurance_expiry TEXT,
  fitness_expiry TEXT,
  status TEXT NOT NULL,
  do_user TEXT,
  da_user TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.vehicle_trip_log (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL,
  driver_id TEXT,
  trip_date TEXT NOT NULL,
  purpose TEXT,
  route TEXT,
  odometer_start DOUBLE PRECISION,
  odometer_end DOUBLE PRECISION,
  distance_km DOUBLE PRECISION,
  fuel_consumed DOUBLE PRECISION,
  officer_id TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.vehicle_fuel_register (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL,
  fuel_date TEXT NOT NULL,
  quantity_litres DOUBLE PRECISION NOT NULL,
  rate_per_litre DOUBLE PRECISION,
  total_amount DOUBLE PRECISION,
  voucher_id TEXT,
  officer_id TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.vehicle_maintenance (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL,
  maintenance_type TEXT NOT NULL,
  service_date TEXT NOT NULL,
  description TEXT,
  cost DOUBLE PRECISION,
  vendor_name TEXT,
  voucher_id TEXT,
  next_service_date TEXT,
  officer_id TEXT
);

-- ============== IOMS M-08: Construction & Maintenance ==============

CREATE TABLE IF NOT EXISTS gapmc.works (
  id TEXT PRIMARY KEY,
  work_no TEXT UNIQUE,
  yard_id TEXT NOT NULL,
  work_type TEXT NOT NULL,
  description TEXT,
  location TEXT,
  contractor_name TEXT,
  contractor_contact TEXT,
  estimate_amount DOUBLE PRECISION,
  tender_value DOUBLE PRECISION,
  work_order_no TEXT,
  work_order_date TEXT,
  start_date TEXT,
  end_date TEXT,
  completion_date TEXT,
  status TEXT NOT NULL,
  do_user TEXT,
  dv_user TEXT,
  da_user TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.works_bills (
  id TEXT PRIMARY KEY,
  work_id TEXT NOT NULL,
  bill_no TEXT,
  bill_date TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  cumulative_paid DOUBLE PRECISION DEFAULT 0,
  voucher_id TEXT,
  status TEXT NOT NULL,
  approved_by TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.amc_contracts (
  id TEXT PRIMARY KEY,
  yard_id TEXT NOT NULL,
  contractor_name TEXT NOT NULL,
  description TEXT,
  amount_per_period DOUBLE PRECISION NOT NULL,
  period_type TEXT,
  contract_start TEXT NOT NULL,
  contract_end TEXT NOT NULL,
  status TEXT NOT NULL,
  da_user TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.amc_bills (
  id TEXT PRIMARY KEY,
  amc_id TEXT NOT NULL,
  bill_date TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  voucher_id TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.land_records (
  id TEXT PRIMARY KEY,
  yard_id TEXT NOT NULL,
  survey_no TEXT NOT NULL,
  village TEXT,
  taluk TEXT,
  district TEXT,
  area_sqm DOUBLE PRECISION,
  sale_deed_no TEXT,
  sale_deed_date TEXT,
  encumbrance TEXT,
  remarks TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gapmc.fixed_assets (
  id TEXT PRIMARY KEY,
  yard_id TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  description TEXT,
  acquisition_date TEXT NOT NULL,
  acquisition_value DOUBLE PRECISION NOT NULL,
  useful_life_years INTEGER,
  depreciation_method TEXT,
  current_book_value DOUBLE PRECISION,
  disposal_date TEXT,
  disposal_value DOUBLE PRECISION,
  disposal_approved_by TEXT,
  works_id TEXT,
  status TEXT NOT NULL
);

-- ============== IOMS M-09: Correspondence Management ==============

CREATE TABLE IF NOT EXISTS gapmc.dak_inward (
  id TEXT PRIMARY KEY,
  diary_no TEXT UNIQUE,
  received_date TEXT NOT NULL,
  from_party TEXT NOT NULL,
  from_address TEXT,
  subject TEXT NOT NULL,
  mode_of_receipt TEXT NOT NULL,
  received_by TEXT,
  assigned_to TEXT,
  deadline TEXT,
  file_ref TEXT,
  status TEXT NOT NULL,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.dak_outward (
  id TEXT PRIMARY KEY,
  despatch_no TEXT UNIQUE,
  despatch_date TEXT NOT NULL,
  to_party TEXT NOT NULL,
  to_address TEXT,
  subject TEXT NOT NULL,
  mode_of_despatch TEXT NOT NULL,
  inward_ref_id TEXT,
  file_ref TEXT,
  despatched_by TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.dak_action_log (
  id TEXT PRIMARY KEY,
  inward_id TEXT NOT NULL,
  action_by TEXT NOT NULL,
  action_date TEXT NOT NULL,
  action_note TEXT,
  status_after TEXT
);

CREATE TABLE IF NOT EXISTS gapmc.dak_escalations (
  id TEXT PRIMARY KEY,
  inward_id TEXT NOT NULL,
  escalated_to TEXT NOT NULL,
  escalation_reason TEXT,
  escalated_at TEXT NOT NULL,
  resolved_at TEXT
);

-- End of schema backup
