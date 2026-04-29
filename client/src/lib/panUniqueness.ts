import { normalizePanInput, isValidPanFormat } from "@shared/india-validation";

export async function checkPanUniqueness(panRaw: string): Promise<{ ok: boolean; message?: string }> {
  const pan = normalizePanInput(panRaw);
  if (!isValidPanFormat(pan)) return { ok: true };

  const res = await fetch(`/api/identity/pan/check?pan=${encodeURIComponent(pan)}`, {
    method: "GET",
    credentials: "include",
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
  if (!res.ok) return { ok: false, message: data.error ?? data.message ?? res.statusText };
  return { ok: Boolean(data.ok), message: data.message };
}

