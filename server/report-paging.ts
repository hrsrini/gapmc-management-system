/**
 * Shared server-side pagination + partial text search for IOMS report JSON APIs.
 */
import type { Request } from "express";
export type ReportPageSize = 25 | 50 | "all";

export function parseReportPaging(req: Request): {
  page: number;
  pageSize: ReportPageSize;
  q: string;
} {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const raw = String(req.query.pageSize ?? "25").toLowerCase();
  const pageSize: ReportPageSize = raw === "all" ? "all" : raw === "50" ? 50 : 25;
  const q = String(req.query.q ?? "").trim();
  return { page, pageSize, q };
}

/** ILIKE pattern for user query (partial match); escapes % and _. */
export function reportSearchPattern(q: string): string | undefined {
  const t = q.trim();
  if (!t) return undefined;
  const esc = t.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
  return `%${esc}%`;
}
