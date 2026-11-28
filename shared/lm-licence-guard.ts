/**
 * License Manager (App 1) linkage guards for gapmc.trader_licences.
 * See docs/license_intra_integration.md §5.3
 */

export type LmLinkedLicence = {
  lmSyncedAt?: string | Date | null;
  lmIsActive?: boolean | null;
  commodities?: string[] | null;
  isBlocked?: boolean | null;
  status?: string | null;
  /** When set, this licence was replaced by a new number — no new transactions. */
  supersededByLicenceId?: string | null;
};

export class LmLicenceGuardError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "LmLicenceGuardError";
    this.code = code;
  }
}

export type LmLicenceAssertOpts = {
  /**
   * Case B (expired holder): allow auto-expiry blocked / LM-inactive licences;
   * still enforce commodity allow-list when linked.
   */
  allowExpiredHolder?: boolean;
};

/**
 * Enforce LM rules only when the row is linked (`lmSyncedAt` set).
 * App 2-only licences (Hamali etc.) skip LM checks.
 */
export function assertLmLicenceAllowsOperation(
  licence: LmLinkedLicence,
  commodity?: string,
  opts?: LmLicenceAssertOpts,
): void {
  const allowExpired = opts?.allowExpiredHolder === true;

  // Old/New License Number Management: superseded old is never selectable for new ops
  // (including Case B expired holder once linked to a new licence).
  if (licence.supersededByLicenceId != null && String(licence.supersededByLicenceId).trim() !== "") {
    throw new LmLicenceGuardError(
      "LICENCE_SUPERSEDED",
      "This licence number has been replaced by a new licence. Use the new licence number for all transactions.",
    );
  }

  if (!allowExpired && (licence.isBlocked || licence.status === "Blocked")) {
    throw new LmLicenceGuardError("LICENCE_BLOCKED", "Licence is blocked");
  }

  if (licence.lmSyncedAt == null || String(licence.lmSyncedAt).trim() === "") {
    return;
  }

  if (!allowExpired && licence.lmIsActive !== true) {
    throw new LmLicenceGuardError("LICENCE_LM_INACTIVE", "Licence is not active in License Manager");
  }

  if (commodity && Array.isArray(licence.commodities) && licence.commodities.length > 0) {
    if (!licence.commodities.includes(commodity)) {
      throw new LmLicenceGuardError("LICENCE_COMMODITY_NOT_ALLOWED", "Commodity not allowed on this licence");
    }
  }
}

/** True when licence has been synced from License Manager. */
export function isLmLinkedLicence(licence: { lmSyncedAt?: string | Date | null }): boolean {
  return licence.lmSyncedAt != null && String(licence.lmSyncedAt).trim() !== "";
}
