/** React Query prefix for bug list (all scope × status combinations). */
export const BUGS_LIST_QUERY_ROOT = ["bugs", "list"] as const;

export function bugsListUrl(scope: "all" | "mine", status: string): string {
  const params = new URLSearchParams();
  params.set("scope", scope);
  if (status) params.set("status", status);
  const q = params.toString();
  return q ? `/api/bugs?${q}` : "/api/bugs";
}

export function bugsListQueryKey(scope: "all" | "mine", status: string) {
  return [...BUGS_LIST_QUERY_ROOT, scope, status || "any"] as const;
}
