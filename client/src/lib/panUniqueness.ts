import { normalizePanInput, isValidPanFormat } from "@shared/india-validation";

export type PanCheckExcludes = {
  excludeEmployeeId?: string;
  excludeEntityId?: string;
  excludeAdHocEntityId?: string;
  excludeTraderLicenceId?: string;
  excludeTraderId?: string;
};

function appendExcludes(params: URLSearchParams, excludes: PanCheckExcludes | undefined) {
  if (!excludes) return;
  if (excludes.excludeEmployeeId) params.set("excludeEmployeeId", excludes.excludeEmployeeId);
  if (excludes.excludeEntityId) params.set("excludeEntityId", excludes.excludeEntityId);
  if (excludes.excludeAdHocEntityId) params.set("excludeAdHocEntityId", excludes.excludeAdHocEntityId);
  if (excludes.excludeTraderLicenceId) params.set("excludeTraderLicenceId", excludes.excludeTraderLicenceId);
  if (excludes.excludeTraderId) params.set("excludeTraderId", excludes.excludeTraderId);
}

/** Server-side uniqueness on blur (H.2.2); pass excludes when editing an existing row. */
export async function checkPanUniqueness(
  panRaw: string,
  excludes?: PanCheckExcludes,
): Promise<{ ok: boolean; message?: string }> {
  const pan = normalizePanInput(panRaw);
  if (!isValidPanFormat(pan)) return { ok: true };

  const params = new URLSearchParams({ pan });
  appendExcludes(params, excludes);
  const res = await fetch(`/api/identity/pan/check?${params.toString()}`, {
    method: "GET",
    credentials: "include",
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
  if (!res.ok) return { ok: false, message: data.error ?? data.message ?? res.statusText };
  return { ok: Boolean(data.ok), message: data.message };
}
