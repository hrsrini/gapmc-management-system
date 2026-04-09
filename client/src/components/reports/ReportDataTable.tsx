import { useCallback, useEffect, useLayoutEffect, isValidElement, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, X, ChevronLeft, ChevronRight } from "lucide-react";

export type ReportPageSizeOption = 25 | 50 | "all";

export interface ReportTableColumn {
  key: string;
  header: string;
}

export interface ReportPagedParams {
  page: number;
  pageSize: ReportPageSizeOption;
  q: string;
}

interface ReportDataTableProps {
  columns: ReportTableColumn[];
  rows: Record<string, unknown>[];
  total: number;
  params: ReportPagedParams;
  onParamsChange: (next: Partial<ReportPagedParams>) => void;
  isLoading?: boolean;
  searchPlaceholder?: string;
  debounceMs?: number;
  emptyMessage?: string;
}

function cellContent(row: Record<string, unknown>, key: string): ReactNode {
  const v = row[key];
  if (v == null || v === "") return "—";
  if (isValidElement(v)) return v;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function ReportDataTable({
  columns,
  rows,
  total,
  params,
  onParamsChange,
  isLoading = false,
  searchPlaceholder = "Search…",
  debounceMs = 350,
  emptyMessage = "No records found",
}: ReportDataTableProps) {
  const [draftQ, setDraftQ] = useState(params.q);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const bottomScrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0);

  useEffect(() => {
    setDraftQ(params.q);
  }, [params.q]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (draftQ !== params.q) {
        onParamsChange({ q: draftQ, page: 1 });
      }
    }, debounceMs);
    return () => window.clearTimeout(t);
  }, [draftQ, debounceMs, onParamsChange, params.q]);

  useLayoutEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setScrollWidth(el.scrollWidth);
    });
    ro.observe(el);
    setScrollWidth(el.scrollWidth);
    return () => ro.disconnect();
  }, [rows, columns]);

  const syncScroll = useCallback((source: HTMLDivElement) => {
    const x = source.scrollLeft;
    [topScrollRef, mainScrollRef, bottomScrollRef].forEach((r) => {
      if (r.current && r.current !== source) r.current.scrollLeft = x;
    });
  }, []);

  const totalPages =
    params.pageSize === "all" ? 1 : Math.max(1, Math.ceil(total / params.pageSize));
  const fromIdx = params.pageSize === "all" ? 1 : (params.page - 1) * params.pageSize + 1;
  const toIdx =
    params.pageSize === "all"
      ? total
      : Math.min(params.page * params.pageSize, total);

  const onKeyDownSearch = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onParamsChange({ q: draftQ, page: 1 });
    }
  };

  const spacer = (
    <div
      className="h-1 shrink-0"
      style={{ width: scrollWidth > 0 ? scrollWidth : "100%" }}
      aria-hidden
    />
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="flex flex-1 flex-col gap-2 min-w-[200px] max-w-xl">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8 pr-9"
              placeholder={searchPlaceholder}
              value={draftQ}
              onChange={(e) => setDraftQ(e.target.value)}
              onKeyDown={onKeyDownSearch}
              aria-label="Search"
            />
            {draftQ ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0.5 top-1/2 h-8 w-8 -translate-y-1/2"
                onClick={() => {
                  setDraftQ("");
                  onParamsChange({ q: "", page: 1 });
                }}
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground whitespace-nowrap">Rows per page</span>
          <Select
            value={params.pageSize === "all" ? "all" : String(params.pageSize)}
            onValueChange={(v) =>
              onParamsChange({
                pageSize: v === "all" ? "all" : (Number(v) as 25 | 50),
                page: 1,
              })
            }
          >
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="25">25</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div
        ref={topScrollRef}
        className="overflow-x-auto overflow-y-hidden border rounded-t-md border-b-0 bg-muted/30"
        style={{ scrollbarGutter: "stable" }}
        onScroll={(e) => syncScroll(e.currentTarget)}
      >
        {spacer}
      </div>

      <div
        ref={mainScrollRef}
        className="overflow-auto max-h-[min(60vh,560px)] border-x border-border rounded-none scroll-smooth"
        onScroll={(e) => syncScroll(e.currentTarget)}
      >
        <table ref={tableRef} className="w-full caption-bottom text-sm min-w-max border-collapse">
          <thead className="sticky top-0 z-20 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
            <tr className="border-b">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className="h-10 px-3 text-left align-middle font-medium text-muted-foreground whitespace-nowrap bg-background"
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={columns.length} className="p-8 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="p-8 text-center text-muted-foreground">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={String(row.id ?? i)} className="border-b transition-colors hover:bg-muted/50">
                  {columns.map((c) => (
                    <td key={c.key} className="p-3 align-middle max-w-[320px]">
                      <div className="truncate whitespace-nowrap">{cellContent(row, c.key)}</div>
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div
        ref={bottomScrollRef}
        className="overflow-x-auto overflow-y-hidden border rounded-b-md border-t-0 bg-muted/30"
        onScroll={(e) => syncScroll(e.currentTarget)}
      >
        {spacer}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm text-muted-foreground">
        <p>
          {total === 0
            ? "0 records"
            : params.pageSize === "all"
              ? `Showing all ${total} record${total === 1 ? "" : "s"}`
              : `Showing ${fromIdx}–${toIdx} of ${total} records · Page ${params.page} of ${totalPages}`}
        </p>
        {params.pageSize !== "all" && total > 0 ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={params.page <= 1 || isLoading}
              onClick={() => onParamsChange({ page: params.page - 1 })}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={params.page >= totalPages || isLoading}
              onClick={() => onParamsChange({ page: params.page + 1 })}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
