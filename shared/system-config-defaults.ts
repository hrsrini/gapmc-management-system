/**
 * Canonical keys and defaults for gapmc.system_config (M-10 Admin → Config).
 * Keep in sync with seed-ioms-m10 and Admin Config UI.
 */
export const SYSTEM_CONFIG_DEFAULTS = {
  market_fee_percent: "1.00",
  msp_rate: "10.00",
  admin_charges: "0.00",
  licence_fee: "300.00",
  /** Legacy rent deposit opening balance migration: records on/before this date (ISO) are treated as migrated baseline (client: 31-Mar-2026). */
  rent_deposit_migration_cutoff: "2026-03-31",
  /** M-09: `per_yard` (default) or `central` (single HO-wide diary sequence). */
  dak_diary_sequence_scope: "per_yard",
} as const;

export type SystemConfigKey = keyof typeof SYSTEM_CONFIG_DEFAULTS;

/** Stable field order for Admin Config UI and server validation. */
export const SYSTEM_CONFIG_KEYS: SystemConfigKey[] = [
  "market_fee_percent",
  "msp_rate",
  "admin_charges",
  "licence_fee",
  "rent_deposit_migration_cutoff",
  "dak_diary_sequence_scope",
];

export const SYSTEM_CONFIG_LABELS: Record<SystemConfigKey, string> = {
  market_fee_percent: "Market Fee %",
  msp_rate: "MSP Rate",
  admin_charges: "Admin Charges",
  licence_fee: "Licence Fee",
  rent_deposit_migration_cutoff: "Rent deposit migration cut-off (ISO date)",
  dak_diary_sequence_scope: "Dak diary numbering: per_yard | central",
};
