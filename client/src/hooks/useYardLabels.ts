import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

export type YardLabelRow = {
  id: string;
  name?: string | null;
  code?: string | null;
  type?: string | null;
  isActive?: boolean | null;
};

/** Prefer name, then code; never invent a placeholder when id is missing. */
export function formatYardLabel(yard: Pick<YardLabelRow, "name" | "code"> | null | undefined): string {
  if (!yard) return "";
  const name = String(yard.name ?? "").trim();
  if (name) return name;
  return String(yard.code ?? "").trim();
}

/**
 * Org-wide yard id → display name map (`GET /api/yards/for-labels`).
 * Use for tables/detail panes so Checkpost/HO users see real location names
 * even when `/api/yards` is limited to their posting location.
 */
export function useYardLabels() {
  const query = useQuery<YardLabelRow[]>({
    queryKey: ["/api/yards/for-labels"],
    staleTime: 5 * 60_000,
  });

  const yardNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const y of query.data ?? []) {
      const label = formatYardLabel(y);
      if (y.id && label) map[y.id] = label;
    }
    return map;
  }, [query.data]);

  const getYardName = useMemo(() => {
    return (yardId: string | null | undefined, fallback = "—") => {
      const id = String(yardId ?? "").trim();
      if (!id) return fallback;
      return yardNameById[id] || fallback;
    };
  }, [yardNameById]);

  return {
    ...query,
    yards: query.data ?? [],
    yardNameById,
    getYardName,
  };
}
