import { eq } from "drizzle-orm";
import { db } from "./db";
import { traderLicences } from "@shared/db-schema";

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
