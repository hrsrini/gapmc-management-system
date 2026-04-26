/**
 * Canonical keys and defaults for gapmc.system_config (M-10 Admin → Config).
 * Keep in sync with seed-ioms-m10 and Admin Config UI.
 */
export const SYSTEM_CONFIG_DEFAULTS = {
  market_fee_percent: "1.00",
  /** M-04 / FR-AST-014 (phase-1): transaction window end date (ISO). After this date, transactions are hard-blocked when licence is expired. */
  market_transaction_window_end_iso: "2026-04-30",
  /** M-04: statutory deadline day of month for filing prior month return (default 7). */
  market_return_deadline_day: "7",
  /** M-04: penal interest rate % p.a. for late filing (simple daily; default 18% p.a.). */
  market_return_interest_percent_per_annum: "18",
  /** US-M04-004: warn when advance balance drops below this INR. */
  market_fee_advance_min_threshold_inr: "2000",
  msp_rate: "10.00",
  admin_charges: "0.00",
  licence_fee: "300.00",
  /** Legacy rent deposit opening balance migration: records on/before this date (ISO) are treated as migrated baseline (client: 31-Mar-2026). */
  rent_deposit_migration_cutoff: "2026-03-31",
  /** M-09: `per_yard` (default) or `central` (single HO-wide diary sequence). */
  dak_diary_sequence_scope: "per_yard",
  /** M-03: simple daily arrears interest after due (e.g. cheque dishonour hint); SRS default 18% p.a. */
  rent_arrears_interest_percent_per_annum: "18",
  /** M-03: annual rent (monthly × 12) above this INR threshold triggers TDS when PAN is valid on licence (194-I style). */
  rent_tds_annual_threshold_inr: "240000",
  /** M-03: TDS % applied to monthly rent (pre-GST) when threshold exceeded and PAN valid. */
  rent_tds_rate_percent: "10",
  /** M-03 Sr.17: optional default % for “Adjust vs baseline” on rent revisions UI (0 = leave field empty). */
  rent_revision_suggested_percent: "0",
  /** M-08: when `true`, cron / HTTP AMC monthly bill job may create rows; Excel default is manual (`false`). */
  amc_monthly_auto_generate: "false",
  /** M-05: allow unauthenticated receipt verify + public QR (`true` / `false`). Overridden if env `PUBLIC_RECEIPT_VERIFY_ENABLED=false`. */
  public_receipt_verify_enabled: "true",
  /** M-06: optional URL to GFR/treasury authority for expenditure heads (shown on voucher forms). */
  expenditure_head_authority_url: "",
  /** M-10 / reports: allow `format=xml` on `/api/ioms/reports/tally-export` (interchange v1). */
  tally_xml_export_enabled: "true",
  /**
   * US-M10-003: MFA enforcement (TOTP) for privileged roles.
   * Default false for easier rollout; enable only when MFA setup process is ready for users.
   */
  mfa_privileged_enforced: "false",
  /** Cross-cutting (Q50): policy age in years for read-only retention counts — IOMS receipts (M-05). */
  data_retention_ioms_receipts_years: "10",
  /** Policy age in years for payment vouchers (M-06). */
  data_retention_payment_vouchers_years: "7",
  /** Policy age in years for Dak inward (M-09). */
  data_retention_dak_inward_years: "7",
  /** Policy age in years for Dak outward (M-09). */
  data_retention_dak_outward_years: "7",
  /** Policy age in years for `audit_log` rows (created_at). */
  data_retention_audit_log_years: "7",
  /** Policy age in years for HR `employees` rows (created_at date when present). */
  data_retention_employees_years: "10",
  /** Policy age in years for M-03 rent invoices (by period_month YYYY-MM vs cutoff month). */
  data_retention_rent_invoices_years: "8",
  /** Policy age in years for M-10 `land_records` (created_at). */
  data_retention_land_records_years: "15",
  /** Policy age in years for bug tickets (created_at). */
  data_retention_bug_tickets_years: "3",
  /** Policy age in years for M-04 purchase_transactions (transaction_date). */
  data_retention_purchase_transactions_years: "7",
  /** Policy age in years for M-04 check_post_inward (entry_date). */
  data_retention_check_post_inward_years: "7",
  /** Optional text appended to rent dishonour / reversal audit hints (e.g. typical bank charge note). */
  rent_dishonour_bank_charge_hint: "",
  /** Optional numeric reference for typical bank charge on dishonour (INR; shown in hints only, not posted). */
  rent_dishonour_bank_charge_inr: "0",
  /** Retention policy (years) for M-10 `users` rows (created_at date when present). */
  data_retention_users_years: "7",
  /**
   * Policy age in years for `public.session` (connect-pg-simple): rows with expire ≤ cutoff unix.
   * Count is 0 when the table does not exist (dev / memory session store).
   */
  data_retention_login_session_rows_years: "2",
  /** M-02 trader_licences.created_at (when present). */
  data_retention_trader_licences_years: "10",
  /** M-02 pre_receipts: coalesce(issued_at, updated_at) date. */
  data_retention_pre_receipts_years: "7",
  /** M-03 rent_deposit_ledger.entry_date. */
  data_retention_rent_deposit_ledger_years: "10",
  /** M-01 leave_requests.from_date (application window start). */
  data_retention_leave_requests_years: "10",
  /** M-02 trader_blocking_log.actioned_at. */
  data_retention_trader_blocking_log_years: "7",
  /**
   * M-01 TA/DA: JSON array of entitlement rows (pay level band, train class, DA A/B city INR/day, hotel ceilings).
   * Default matches workbook "TADA Entitlement Matrix" (rates admin-editable).
   */
  ta_da_entitlement_json:
    '[{"payLevel":"1-5","trainClass":"Sleeper / 3AC","daA":500,"daB":300,"hotelA":1000,"hotelB":800},{"payLevel":"6-8","trainClass":"AC 3 Tier","daA":800,"daB":500,"hotelA":2250,"hotelB":1500},{"payLevel":"9-11","trainClass":"AC 2 Tier","daA":1200,"daB":800,"hotelA":4500,"hotelB":3000},{"payLevel":"12-13","trainClass":"AC 1st Class","daA":1500,"daB":1000,"hotelA":7500,"hotelB":4500},{"payLevel":"14+","trainClass":"AC 1st / Air (Economy)","daA":2000,"daB":1200,"hotelA":10000,"hotelB":6000}]',
  /** M-01 Leave: EL credit per half-year (days). */
  leave_el_credit_half_year_days: "15",
  /** M-01 Leave: CL credit per year (days). */
  leave_cl_credit_year_days: "8",
  /** M-01 Leave: HPL credit per year (days). */
  leave_hpl_credit_year_days: "20",
  /** M-01 Leave: EL balance cap (days) for warning. */
  leave_el_cap_days: "300",
  /** M-01 Leave: JSON array of holiday ISO dates (YYYY-MM-DD). */
  leave_holidays_json: "[]",
} as const;

export type SystemConfigKey = keyof typeof SYSTEM_CONFIG_DEFAULTS;

/** Stable field order for Admin Config UI and server validation. */
export const SYSTEM_CONFIG_KEYS: SystemConfigKey[] = [
  "market_fee_percent",
  "market_transaction_window_end_iso",
  "market_return_deadline_day",
  "market_return_interest_percent_per_annum",
  "market_fee_advance_min_threshold_inr",
  "msp_rate",
  "admin_charges",
  "licence_fee",
  "rent_deposit_migration_cutoff",
  "dak_diary_sequence_scope",
  "rent_arrears_interest_percent_per_annum",
  "rent_tds_annual_threshold_inr",
  "rent_tds_rate_percent",
  "rent_revision_suggested_percent",
  "amc_monthly_auto_generate",
  "public_receipt_verify_enabled",
  "expenditure_head_authority_url",
  "tally_xml_export_enabled",
  "mfa_privileged_enforced",
  "data_retention_ioms_receipts_years",
  "data_retention_payment_vouchers_years",
  "data_retention_dak_inward_years",
  "data_retention_dak_outward_years",
  "data_retention_audit_log_years",
  "data_retention_employees_years",
  "data_retention_rent_invoices_years",
  "data_retention_land_records_years",
  "data_retention_bug_tickets_years",
  "data_retention_purchase_transactions_years",
  "data_retention_check_post_inward_years",
  "rent_dishonour_bank_charge_hint",
  "rent_dishonour_bank_charge_inr",
  "data_retention_users_years",
  "data_retention_login_session_rows_years",
  "data_retention_trader_licences_years",
  "data_retention_pre_receipts_years",
  "data_retention_rent_deposit_ledger_years",
  "data_retention_leave_requests_years",
  "data_retention_trader_blocking_log_years",
  "ta_da_entitlement_json",
  "leave_el_credit_half_year_days",
  "leave_cl_credit_year_days",
  "leave_hpl_credit_year_days",
  "leave_el_cap_days",
  "leave_holidays_json",
];

export const SYSTEM_CONFIG_LABELS: Record<SystemConfigKey, string> = {
  market_fee_percent: "Market Fee %",
  market_transaction_window_end_iso: "M-04: licence expiry transaction window end date (ISO)",
  market_return_deadline_day: "M-04 Returns: deadline day of month (1–28; default 7)",
  market_return_interest_percent_per_annum: "M-04 Returns: late interest % p.a. (simple daily; default 18)",
  market_fee_advance_min_threshold_inr: "M-04 Advance: low-balance threshold (INR; default 2000)",
  msp_rate: "MSP Rate",
  admin_charges: "Admin Charges",
  licence_fee: "Licence Fee",
  rent_deposit_migration_cutoff: "Rent deposit migration cut-off (ISO date)",
  dak_diary_sequence_scope: "Dak diary numbering (per_yard only; central disabled per policy)",
  rent_arrears_interest_percent_per_annum: "Rent arrears interest % p.a. (simple daily; dishonour hint)",
  rent_tds_annual_threshold_inr: "Rent TDS: annual threshold (INR; monthly rent × 12 vs this)",
  rent_tds_rate_percent: "Rent TDS: % on monthly rent when above threshold + valid PAN",
  rent_revision_suggested_percent:
    "Rent revision UI: default % vs baseline (0 = empty; pre-fills Adjust field on /rent/ioms/revisions)",
  amc_monthly_auto_generate: "AMC: allow auto monthly bill cron (true|false)",
  public_receipt_verify_enabled: "Public receipt verification (true|false)",
  expenditure_head_authority_url: "Expenditure head authority URL (optional)",
  tally_xml_export_enabled: "Tally export: allow XML interchange (true|false)",
  mfa_privileged_enforced: "Auth: enforce MFA for privileged roles (DA/ADMIN/ACCOUNTS) (true|false)",
  data_retention_ioms_receipts_years: "Retention policy (years) — IOMS receipts count snapshot",
  data_retention_payment_vouchers_years: "Retention policy (years) — payment vouchers count snapshot",
  data_retention_dak_inward_years: "Retention policy (years) — Dak inward count snapshot",
  data_retention_dak_outward_years: "Retention policy (years) — Dak outward count snapshot",
  data_retention_audit_log_years: "Retention policy (years) — audit_log count snapshot",
  data_retention_employees_years: "Retention policy (years) — employees count snapshot",
  data_retention_rent_invoices_years: "Retention policy (years) — rent invoices (by period_month) snapshot",
  data_retention_land_records_years: "Retention policy (years) — land_records count snapshot",
  data_retention_bug_tickets_years: "Retention policy (years) — bug_tickets count snapshot",
  data_retention_purchase_transactions_years: "Retention policy (years) — M-04 purchase_transactions snapshot",
  data_retention_check_post_inward_years: "Retention policy (years) — check_post_inward snapshot",
  rent_dishonour_bank_charge_hint: "Rent dishonour: optional bank charge / re-present note (shown in hints)",
  rent_dishonour_bank_charge_inr: "Rent dishonour: optional reference bank charge (INR; hints only)",
  data_retention_users_years: "Retention policy (years) — users (created_at) count snapshot",
  data_retention_login_session_rows_years:
    "Retention policy (years) — express-session public.session rows (expire ≤ cutoff; absent in dev/memory store)",
  data_retention_trader_licences_years: "Retention policy (years) — trader_licences.created_at snapshot",
  data_retention_pre_receipts_years: "Retention policy (years) — pre_receipts (issued_at, else updated_at) snapshot",
  data_retention_rent_deposit_ledger_years: "Retention policy (years) — rent_deposit_ledger.entry_date snapshot",
  data_retention_leave_requests_years: "Retention policy (years) — leave_requests.from_date snapshot",
  data_retention_trader_blocking_log_years: "Retention policy (years) — trader_blocking_log.actioned_at snapshot",
  ta_da_entitlement_json: "M-01 TA/DA: entitlement matrix JSON (payLevel, trainClass, daA, daB, hotelA, hotelB in INR)",
  leave_el_credit_half_year_days: "M-01 Leave: EL credit per half-year (days)",
  leave_cl_credit_year_days: "M-01 Leave: CL credit per year (days)",
  leave_hpl_credit_year_days: "M-01 Leave: HPL credit per year (days)",
  leave_el_cap_days: "M-01 Leave: EL cap (days) for warning",
  leave_holidays_json: "M-01 Leave: holidays JSON array (YYYY-MM-DD)",
};
