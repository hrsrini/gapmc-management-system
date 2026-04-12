import { useQuery } from "@tanstack/react-query";
import type { ApiYardRef } from "@/lib/legacyYardMatch";

/** Active, role-scoped locations for operational dropdowns (`GET /api/yards`). */
export function useScopedActiveYards() {
  return useQuery<ApiYardRef[]>({
    queryKey: ["/api/yards"],
  });
}
