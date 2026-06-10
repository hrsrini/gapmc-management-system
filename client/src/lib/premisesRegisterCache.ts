import type { QueryClient } from "@tanstack/react-query";

/** Refresh unified premises register and legacy asset/vacant list caches. */
export function invalidatePremisesRegisterQueries(queryClient: QueryClient): void {
  queryClient.invalidateQueries({
    predicate: (q) =>
      typeof q.queryKey[0] === "string" &&
      (q.queryKey[0].startsWith("/api/ioms/premises-register") ||
        q.queryKey[0] === "/api/ioms/assets/vacant" ||
        q.queryKey[0] === "/api/ioms/assets"),
  });
}
