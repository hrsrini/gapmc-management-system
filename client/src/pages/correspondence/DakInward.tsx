import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { Mail, AlertCircle, PlusCircle, Search } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatYmdToDisplay } from "@/lib/dateFormat";

interface Inward {
  id: string;
  diaryNo?: string | null;
  receivedDate: string;
  fromParty: string;
  subject: string;
  modeOfReceipt: string;
  status: string;
  assignedTo?: string | null;
  deadline?: string | null;
}

export default function DakInward() {
  const { can } = useAuth();
  const canCreate = can("M-09", "Create");
  const [searchParams, setSearchParams] = useSearchParams();
  const [subjectDraft, setSubjectDraft] = useState("");
  const [subjectApplied, setSubjectApplied] = useState("");

  useEffect(() => {
    const s = searchParams.get("subject")?.trim() ?? "";
    setSubjectDraft(s);
    setSubjectApplied(s);
  }, [searchParams]);

  const inwardListUrl = useMemo(() => {
    const p = new URLSearchParams();
    if (subjectApplied.trim()) p.set("subject", subjectApplied.trim());
    const qs = p.toString();
    return qs ? `/api/ioms/dak/inward?${qs}` : `/api/ioms/dak/inward`;
  }, [subjectApplied]);
  const { data: list, isLoading, isError } = useQuery<Inward[]>({
    queryKey: [inwardListUrl],
  });

  const inwardColumns = useMemo(
    (): ReportTableColumn[] => [
      { key: "_diary", header: "Diary No", sortField: "diarySort" },
      { key: "receivedDate", header: "Received" },
      { key: "fromParty", header: "From" },
      { key: "subject", header: "Subject" },
      { key: "modeOfReceipt", header: "Mode" },
      { key: "assignedTo", header: "Assigned" },
      { key: "deadline", header: "Deadline" },
      { key: "_status", header: "Status", sortField: "status" },
    ],
    [],
  );

  const inwardRows = useMemo((): Record<string, unknown>[] => {
    return (list ?? []).map((d) => ({
      id: d.id,
      diarySort: d.diaryNo ?? d.id,
      _diary: (
        <Link href={`/correspondence/inward/${d.id}`} className="text-primary hover:underline font-mono text-sm">
          {d.diaryNo ?? d.id}
        </Link>
      ),
      receivedDate: d.receivedDate.slice(0, 10),
      fromParty: d.fromParty,
      subject: d.subject,
      modeOfReceipt: d.modeOfReceipt,
      assignedTo: d.assignedTo ?? "—",
      deadline: d.deadline ? d.deadline.slice(0, 10) : "—",
      status: d.status,
      _status: <Badge variant="secondary">{d.status}</Badge>,
    }));
  }, [list]);

  const { data: slaPayload } = useQuery<{ count: number; asOf: string }>({
    queryKey: ["/api/ioms/dak/inward/sla-overdue"],
  });

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Correspondence (M-09)", href: "/correspondence/inward" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load inward dak.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Correspondence (M-09)", href: "/correspondence/inward" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Dak Inward (IOMS M-09)
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Inward correspondence — diary no, routing, action log, escalation.{" "}
            <Link href="/correspondence/inward/subjects" className="text-primary hover:underline">
              Browse by subject
            </Link>
          </p>
          {slaPayload != null && slaPayload.count > 0 && (
            <Alert variant="destructive" className="mt-3">
              <AlertTitle>Deadline overdue</AlertTitle>
              <AlertDescription>
                {slaPayload.count} inward item(s) have a deadline on or before {formatYmdToDisplay(slaPayload.asOf)} and are not Closed.
              </AlertDescription>
            </Alert>
          )}
          <div className="flex flex-wrap items-end gap-3 pt-2">
            <div className="space-y-1 min-w-[200px] flex-1 max-w-md">
              <Label htmlFor="dak-subject">Subject contains</Label>
              <Input
                id="dak-subject"
                placeholder="Filter by subject text…"
                value={subjectDraft}
                onChange={(e) => setSubjectDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setSubjectApplied(subjectDraft);
                }}
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                const t = subjectDraft.trim();
                setSubjectApplied(t);
                setSearchParams(
                  (prev) => {
                    const p = new URLSearchParams(prev);
                    if (t) p.set("subject", t);
                    else p.delete("subject");
                    return p;
                  },
                  { replace: true },
                );
              }}
            >
              <Search className="h-4 w-4 mr-2" />
              Search
            </Button>
            {subjectApplied && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSubjectDraft("");
                  setSubjectApplied("");
                  setSearchParams(
                    (prev) => {
                      const p = new URLSearchParams(prev);
                      p.delete("subject");
                      return p;
                    },
                    { replace: true },
                  );
                }}
              >
                Clear
              </Button>
            )}
            {canCreate && (
              <Button asChild size="sm" className="ml-auto">
                <Link href="/correspondence/inward/new"><PlusCircle className="h-4 w-4 mr-2" />Add inward</Link>
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={inwardColumns}
              sourceRows={inwardRows}
              searchKeys={["diarySort", "receivedDate", "fromParty", "subject", "modeOfReceipt", "assignedTo", "deadline", "status"]}
              defaultSortKey="receivedDate"
              defaultSortDir="desc"
              emptyMessage="No inward dak."
              resetPageDependency={inwardListUrl}
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
