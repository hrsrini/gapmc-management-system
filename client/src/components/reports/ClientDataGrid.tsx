import { useCallback, useEffect, useMemo, useState } from "react";
import { sliceClientReport } from "@/lib/clientReportSlice";
import { ReportDataTable, type ReportPagedParams, type ReportTableColumn } from "./ReportDataTable";

export interface ClientDataGridProps {
  columns: ReportTableColumn[];
  /** Full row set; filtering, sort, and pagination run in the browser. */
  sourceRows: Record<string, unknown>[];
  /** If set, search only these keys (recommended when rows include React nodes). */
  searchKeys?: string[];
  searchPlaceholder?: string;
  defaultSortKey: string;
  defaultSortDir?: "asc" | "desc";
  isLoading?: boolean;
  emptyMessage?: string;
  /** When this value changes, the grid resets to page 1 (e.g. filters, query URL). */
  resetPageDependency?: unknown;
}

/**
 * Report-style grid for client-loaded lists: synced horizontal scroll, sticky header,
 * search, sort (first click desc), pagination 25/50/All.
 *
 * Remount with `key={...}` when the parent needs a full reset (e.g. tab switch).
 */
export function ClientDataGrid({
  columns,
  sourceRows,
  searchKeys,
  searchPlaceholder = "Search…",
  defaultSortKey,
  defaultSortDir = "desc",
  isLoading = false,
  emptyMessage,
  resetPageDependency,
}: ClientDataGridProps) {
  const [params, setParams] = useState<ReportPagedParams>({
    page: 1,
    pageSize: 25,
    q: "",
    sortKey: defaultSortKey,
    sortDir: defaultSortDir,
  });

  const mergeParams = useCallback((next: Partial<ReportPagedParams>) => {
    setParams((s) => ({ ...s, ...next }));
  }, []);

  useEffect(() => {
    setParams((p) => ({ ...p, page: 1 }));
  }, [resetPageDependency]);

  const { rows, total } = useMemo(
    () => sliceClientReport(sourceRows, params, searchKeys),
    [sourceRows, params, searchKeys],
  );

  const totalPages =
    params.pageSize === "all" ? 1 : Math.max(1, Math.ceil(total / params.pageSize));

  useEffect(() => {
    if (total > 0 && params.page > totalPages) {
      setParams((p) => ({ ...p, page: totalPages }));
    }
  }, [total, totalPages, params.page]);

  return (
    <ReportDataTable
      columns={columns}
      rows={rows}
      total={total}
      params={params}
      onParamsChange={mergeParams}
      isLoading={isLoading}
      searchPlaceholder={searchPlaceholder}
      emptyMessage={emptyMessage}
    />
  );
}
