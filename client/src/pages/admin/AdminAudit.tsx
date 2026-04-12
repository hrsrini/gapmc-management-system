import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollText, AlertCircle, FileJson } from "lucide-react";
import { formatDisplayDateTime } from "@/lib/dateFormat";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";

/** Values must match `audit_log.module` written by the API. */
const MODULE_OPTIONS = [
  "",
  "Agreements",
  "Construction",
  "Cron",
  "Dak",
  "HR",
  "M-01",
  "M-10",
  "Market",
  "Market Fee",
  "Receipts",
  "Rent/Tax",
  "Traders",
  "Vouchers",
];
const LIMIT_OPTIONS = [50, 100, 200];

interface AuditEntry {
  id: string;
  userId: string;
  module: string;
  action: string;
  recordId?: string | null;
  beforeValue?: unknown;
  afterValue?: unknown;
  ip?: string | null;
  createdAt: string;
  userEmail?: string | null;
  userName?: string | null;
}

export default function AdminAudit() {
  const [moduleFilter, setModuleFilter] = useState("");
  const [userIdFilter, setUserIdFilter] = useState("");
  const [limit, setLimit] = useState(100);
  const [detailEntry, setDetailEntry] = useState<AuditEntry | null>(null);

  const params = new URLSearchParams();
  if (moduleFilter) params.set("module", moduleFilter);
  if (userIdFilter.trim()) params.set("userId", userIdFilter.trim());
  params.set("limit", String(limit));
  const url = `/api/admin/audit?${params.toString()}`;
  const { data: entries, isLoading, isError } = useQuery<AuditEntry[]>({
    queryKey: [url],
  });

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return (entries ?? []).map((e) => {
      const hasDetails = e.beforeValue != null || e.afterValue != null;
      return {
        id: e.id,
        createdAt: e.createdAt,
        _timeDisplay: e.createdAt ? formatDisplayDateTime(e.createdAt) : "—",
        userLabel: e.userEmail ?? e.userName ?? e.userId,
        module: e.module,
        action: e.action,
        recordId: e.recordId ?? "—",
        ip: e.ip ?? "—",
        _details: hasDetails ? (
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1" onClick={() => setDetailEntry(e)}>
            <FileJson className="h-4 w-4" />
            Details
          </Button>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        ),
      };
    });
  }, [entries]);

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Admin", href: "/admin/locations" }, { label: "Audit Log" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load audit log.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Admin", href: "/admin/locations" }, { label: "Audit Log" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScrollText className="h-5 w-5" />
            Audit Log
          </CardTitle>
          <p className="text-sm text-muted-foreground">Immutable trail of who did what, when (IOMS M-10).</p>
          <div className="flex flex-wrap items-center gap-4 pt-2">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Module</Label>
              <Select value={moduleFilter || "all"} onValueChange={(v) => setModuleFilter(v === "all" ? "" : v)}>
                <SelectTrigger className="w-[200px] h-8">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {MODULE_OPTIONS.filter(Boolean).map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">User ID</Label>
              <Input
                className="h-8 w-[180px] font-mono text-xs"
                placeholder="Filter by user id"
                value={userIdFilter}
                onChange={(e) => setUserIdFilter(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Limit</Label>
              <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
                <SelectTrigger className="w-[100px] h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LIMIT_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={[
                { key: "_details", header: "" },
                { key: "_timeDisplay", header: "Time", sortField: "createdAt" },
                { key: "userLabel", header: "User" },
                { key: "module", header: "Module" },
                { key: "action", header: "Action" },
                { key: "recordId", header: "Record" },
                { key: "ip", header: "IP" },
              ]}
              sourceRows={sourceRows}
              searchKeys={["createdAt", "userLabel", "module", "action", "recordId", "ip"]}
              searchPlaceholder="Search time, user, module, action, record, IP…"
              defaultSortKey="createdAt"
              defaultSortDir="desc"
              resetPageDependency={url}
              emptyMessage="No audit entries yet."
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={detailEntry != null} onOpenChange={(o) => !o && setDetailEntry(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Audit entry details</DialogTitle>
          </DialogHeader>
          {detailEntry && (
            <div className="space-y-3 text-xs">
              <p className="text-muted-foreground">
                {detailEntry.module} · {detailEntry.action} · {detailEntry.recordId ?? "—"}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {detailEntry.beforeValue != null && (
                  <div>
                    <span className="font-medium text-muted-foreground">Before</span>
                    <pre className="mt-1 p-2 rounded bg-muted border overflow-auto max-h-64 font-mono text-[11px]">
                      {JSON.stringify(detailEntry.beforeValue, null, 2)}
                    </pre>
                  </div>
                )}
                {detailEntry.afterValue != null && (
                  <div>
                    <span className="font-medium text-muted-foreground">After</span>
                    <pre className="mt-1 p-2 rounded bg-muted border overflow-auto max-h-64 font-mono text-[11px]">
                      {JSON.stringify(detailEntry.afterValue, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
