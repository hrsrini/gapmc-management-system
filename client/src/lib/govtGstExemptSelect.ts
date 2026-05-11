/** Row from GET /api/ioms/reference/govt-gst-exempt-categories */
export type GovtGstExemptCategoryRow = { id: string; code: string; name: string };

/**
 * Ensures a controlled Radix Select always has a matching item for the licence FK
 * (reference list still loading, or stale id after DB changes).
 */
export function govtGstCategoriesForSelect(
  rows: GovtGstExemptCategoryRow[],
  storedCategoryId: string | null | undefined,
): GovtGstExemptCategoryRow[] {
  const id = storedCategoryId?.trim();
  if (!id || rows.some((r) => r.id === id)) return rows;
  return [
    {
      id,
      code: "ORPHAN",
      name: `Unknown reference (${id}). Re-run govt/GST reference seed or set to none.`,
    },
    ...rows,
  ];
}
