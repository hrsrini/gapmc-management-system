/** Express 5 types `req.params.*` as `string | string[]` — normalize to a single string. */
export function routeParamString(v: string | string[] | undefined): string {
  if (v == null) return "";
  return Array.isArray(v) ? String(v[0] ?? "") : String(v);
}
