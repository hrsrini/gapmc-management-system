/**
 * Trader licence master data is owned by License Manager (App 1).
 * Until IOMS create/edit/delete is re-enabled, gate mutations behind this flag.
 */
export const TRADER_LICENCE_CRUD_DISABLED = true;

export const TRADER_LICENCE_CRUD_DISABLED_CODE = "LICENCE_CRUD_DISABLED";

export const TRADER_LICENCE_CRUD_DISABLED_MESSAGE =
  "Trader licence create, edit, and delete are disabled. Licences are managed in the License Manager app.";

/** PUT keys still allowed while CRUD is disabled (IOMS operational overlays). */
export const TRADER_LICENCE_OPERATIONAL_PATCH_KEYS = new Set([
  "govtGstExemptCategoryId",
  "isNonGstEntity",
  "isBlocked",
  "blockReason",
]);
