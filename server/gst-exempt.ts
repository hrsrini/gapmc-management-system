import { eq } from "drizzle-orm";
import { db } from "./db";
import { traderLicences, govtGstExemptCategories } from "@shared/db-schema";

/**
 * Normalises `govt_gst_exempt_categories.id` from API input. Empty / null clears the FK.
 */
export async function resolveGovtGstExemptCategoryId(raw: unknown): Promise<
  { ok: true; id: string | null } | { ok: false; code: string; message: string }
> {
  if (raw == null) return { ok: true, id: null };
  const s = String(raw).trim();
  if (!s) return { ok: true, id: null };
  const [row] = await db
    .select({ id: govtGstExemptCategories.id })
    .from(govtGstExemptCategories)
    .where(eq(govtGstExemptCategories.id, s))
    .limit(1);
  if (!row) {
    return {
      ok: false,
      code: "LICENCE_GST_EXEMPT_CATEGORY_INVALID",
      message: "Select a valid govt. office/godown GST exemption category, or leave none.",
    };
  }
  return { ok: true, id: row.id };
}

export async function tenantLicenceIsGstExempt(tenantLicenceId: string): Promise<boolean> {
  if (!tenantLicenceId) return false;
  const [lic] = await db
    .select({
      cat: traderLicences.govtGstExemptCategoryId,
      isNonGst: traderLicences.isNonGstEntity,
    })
    .from(traderLicences)
    .where(eq(traderLicences.id, tenantLicenceId))
    .limit(1);
  return Boolean(lic?.cat) || Boolean(lic?.isNonGst);
}
