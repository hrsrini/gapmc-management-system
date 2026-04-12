import { isValidElement } from "react";
import type { ReportPagedParams, ReportPageSizeOption } from "@/components/reports/ReportDataTable";

function compareReportValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a == null || a === "") return 1;
  if (b == null || b === "") return -1;
  if (typeof a === "number" && typeof b === "number" && Number.isFinite(a) && Number.isFinite(b)) {
    return a - b;
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/** Full-text search over primitive cell values (skips `_`-prefixed keys unless listed). */
export function filterReportRowsByQuery(
  rows: Record<string, unknown>[],
  q: string,
  searchKeys?: string[],
): Record<string, unknown>[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => {
    const keys =
      searchKeys && searchKeys.length > 0
        ? searchKeys
        : Object.keys(row).filter((k) => !k.startsWith("_"));
    for (const k of keys) {
      const v = row[k];
      if (v == null) continue;
      if (isValidElement(v)) continue;
      if (typeof v === "object") continue;
      if (String(v).toLowerCase().includes(needle)) return true;
    }
    return false;
  });
}

export function sortReportRows(
  rows: Record<string, unknown>[],
  sortKey: string,
  sortDir: "asc" | "desc",
): Record<string, unknown>[] {
  const mul = sortDir === "asc" ? 1 : -1;
  return [...rows].sort((r1, r2) => compareReportValues(r1[sortKey], r2[sortKey]) * mul);
}

export function paginateReportRows(
  rows: Record<string, unknown>[],
  page: number,
  pageSize: ReportPageSizeOption,
): Record<string, unknown>[] {
  if (pageSize === "all") return rows;
  const start = (page - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

export function sliceClientReport(
  source: Record<string, unknown>[],
  params: ReportPagedParams,
  searchKeys?: string[],
): { rows: Record<string, unknown>[]; total: number } {
  const filtered = filterReportRowsByQuery(source, params.q, searchKeys);
  const sorted = sortReportRows(filtered, params.sortKey, params.sortDir);
  const total = sorted.length;
  const rows = paginateReportRows(sorted, params.page, params.pageSize);
  return { rows, total };
}
