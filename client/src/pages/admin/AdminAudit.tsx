import { useState, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollText, AlertCircle, ChevronDown, ChevronRight } from "lucide-react";

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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const params = new URLSearchParams();
  if (moduleFilter) params.set("module", moduleFilter);
  if (userIdFilter.trim()) params.set("userId", userIdFilter.trim());
  params.set("limit", String(limit));
  const url = `/api/admin/audit?${params.toString()}`;
  const { data: entries, isLoading, isError } = useQuery<AuditEntry[]>({
    queryKey: [url],
  });

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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Time</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Record</TableHead>
                  <TableHead className="text-muted-foreground">IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(entries ?? []).map((e) => {
                  const hasDetails = e.beforeValue != null || e.afterValue != null;
                  const isExpanded = expandedId === e.id;
                  return (
                    <Fragment key={e.id}>
                      <TableRow>
                        <TableCell className="w-8 p-1">
                          {hasDetails ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => setExpandedId(isExpanded ? null : e.id)}
                              aria-label={isExpanded ? "Hide details" : "Show details"}
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </Button>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                          {e.createdAt ? new Date(e.createdAt).toLocaleString() : "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {e.userEmail ?? e.userName ?? e.userId}
                        </TableCell>
                        <TableCell>{e.module}</TableCell>
                        <TableCell>{e.action}</TableCell>
                        <TableCell className="font-mono text-xs truncate max-w-[120px]">{e.recordId ?? "—"}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{e.ip ?? "—"}</TableCell>
                      </TableRow>
                      {isExpanded && hasDetails && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={7} className="p-4 align-top">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                              {e.beforeValue != null && (
                                <div>
                                  <span className="font-medium text-muted-foreground">Before</span>
                                  <pre className="mt-1 p-2 rounded bg-background border overflow-auto max-h-48 font-mono text-[11px]">
                                    {JSON.stringify(e.beforeValue, null, 2)}
                                  </pre>
                                </div>
                              )}
                              {e.afterValue != null && (
                                <div>
                                  <span className="font-medium text-muted-foreground">After</span>
                                  <pre className="mt-1 p-2 rounded bg-background border overflow-auto max-h-48 font-mono text-[11px]">
                                    {JSON.stringify(e.afterValue, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {!isLoading && (!entries || entries.length === 0) && (
            <p className="text-sm text-muted-foreground py-4">No audit entries yet.</p>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
