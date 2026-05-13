import type { QueryClient } from "@tanstack/react-query";

export function invalidateAssetAllotmentQueries(queryClient: QueryClient): void {
  queryClient.invalidateQueries({
    predicate: (q) => {
      const k = q.queryKey[0];
      return typeof k === "string" && k.startsWith("/api/ioms/asset-allotments");
    },
  });
}
