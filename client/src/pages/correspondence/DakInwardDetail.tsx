import { useMemo, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { Mail, ArrowLeft, Pencil, ListChecks, Loader2, AlertCircle } from "lucide-react";
import { formatYmdToDisplay } from "@/lib/dateFormat";

interface Inward {
  id: string;
  diaryNo?: string | null;
  receivedDate: string;
  fromParty: string;
  subject: string;
  modeOfReceipt: string;
  status: string;
  yardId?: string | null;
  fromAddress?: string | null;
  receivedBy?: string | null;
  assignedTo?: string | null;
  deadline?: string | null;
  fileRef?: string | null;
}
interface ActionLog {
  id: string;
  inwardId: string;
  actionBy: string;
  actionDate: string;
  actionNote?: string | null;
  statusAfter?: string | null;
}
interface YardRef {
  id: string;
  name: string;
}

export default function DakInwardDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { user, can } = useAuth();
  const queryClient = useQueryClient();
  const canUpdate = can("M-09", "Update");
  const canCreate = can("M-09", "Create");
  const [actionNote, setActionNote] = useState("");
  const [statusAfter, setStatusAfter] = useState("");
  const actionByDisplay = user?.name ?? user?.email ?? "Current User";

  const { data: inward, isLoading, isError } = useQuery<Inward>({
    queryKey: ["/api/ioms/dak/inward", id],
  });
  const { data: actions = [], isLoading: actionsLoading } = useQuery<ActionLog[]>({
    queryKey: [`/api/ioms/dak/inward/${id}/actions`],
    enabled: !!id,
  });
  const { data: yards = [] } = useQuery<YardRef[]>({
    queryKey: ["/api/yards"],
  });
  const yardById = Object.fromEntries(yards.map((y) => [y.id, y.name]));

  const actionColumns = useMemo(
    (): ReportTableColumn[] => [
      { key: "actionDate", header: "Date" },
      { key: "actionBy", header: "By" },
      { key: "actionNote", header: "Note" },
      { key: "_statusAfter", header: "Status after", sortField: "statusAfterSort" },
    ],
    [],
  );

  const actionRows = useMemo((): Record<string, unknown>[] => {
    return actions.map((a) => ({
      id: a.id,
      actionDate: a.actionDate,
      actionBy: a.actionBy,
      actionNote: a.actionNote ?? "—",
      statusAfterSort: a.statusAfter ?? "",
      _statusAfter: <Badge variant="outline">{a.statusAfter ?? "—"}</Badge>,
    }));
  }, [actions]);

  const addActionMutation = useMutation({
    mutationFn: async (body: { inwardId: string; actionBy: string; actionNote?: string; statusAfter?: string }) => {
      const res = await fetch("/api/ioms/dak/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/ioms/dak/inward/${id}/actions`] });
      setActionNote("");
      setStatusAfter("");
    },
  });

  const handleAddAction = (e: React.FormEvent) => {
    e.preventDefault();
    addActionMutation.mutate({
      inwardId: id!,
      actionBy: actionByDisplay,
      actionNote: actionNote || undefined,
      statusAfter: statusAfter || undefined,
    });
  };

  if (isLoading || inward === undefined) {
    return (
      <AppShell breadcrumbs={[{ label: "Dak Inward", href: "/correspondence/inward" }, { label: "Detail" }]}>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-8 w-48 mb-4" />
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  if (isError || !inward) {
    return (
      <AppShell breadcrumbs={[{ label: "Dak Inward", href: "/correspondence/inward" }, { label: "Detail" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Inward not found.</span>
            <Button variant="outline" size="sm" onClick={() => setLocation("/correspondence/inward")}>Back to list</Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Dak Inward", href: "/correspondence/inward" }, { label: inward.diaryNo ?? inward.id }]}>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            {inward.diaryNo ?? inward.id}
          </CardTitle>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/correspondence/inward")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/correspondence/inward/${id}/edit`}><Pencil className="h-4 w-4 mr-1" /> Edit</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div><span className="text-muted-foreground">Received date</span><br />{formatYmdToDisplay(inward.receivedDate)}</div>
            <div><span className="text-muted-foreground">From</span><br />{inward.fromParty}</div>
            <div><span className="text-muted-foreground">Mode</span><br />{inward.modeOfReceipt}</div>
            <div><span className="text-muted-foreground">Yard</span><br />{inward.yardId ? (yardById[inward.yardId] ?? inward.yardId) : "—"}</div>
            <div><span className="text-muted-foreground">Status</span><br /><Badge variant="secondary">{inward.status}</Badge></div>
            <div><span className="text-muted-foreground">Assigned to</span><br />{inward.assignedTo ?? "—"}</div>
            <div><span className="text-muted-foreground">Deadline</span><br />{inward.deadline ?? "—"}</div>
            {inward.fromAddress && (
              <div className="md:col-span-2"><span className="text-muted-foreground">From address</span><br />{inward.fromAddress}</div>
            )}
            <div className="md:col-span-2"><span className="text-muted-foreground">Subject</span><br />{inward.subject}</div>
          </div>

          <Tabs defaultValue="actions">
            <TabsList>
              <TabsTrigger value="actions"><ListChecks className="h-4 w-4 mr-1" /> Action log ({actions.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="actions" className="pt-2 space-y-4">
              {canCreate && (
              <form onSubmit={handleAddAction} className="flex flex-wrap items-end gap-2 p-3 border rounded-md bg-muted/30">
                <div className="min-w-[200px]">
                  <Label>Note</Label>
                  <Input value={actionNote} onChange={(e) => setActionNote(e.target.value)} placeholder="Action note" />
                </div>
                <div className="min-w-[120px]">
                  <Label>Status after</Label>
                  <Input value={statusAfter} onChange={(e) => setStatusAfter(e.target.value)} placeholder="Pending/InProgress/Closed" />
                </div>
                <Button type="submit" size="sm" disabled={addActionMutation.isPending}>
                  {addActionMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  Add action
                </Button>
              </form>
              )}
              {actionsLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <ClientDataGrid
                  columns={actionColumns}
                  sourceRows={actionRows}
                  searchKeys={["actionBy", "actionNote", "statusAfterSort"]}
                  defaultSortKey="actionDate"
                  defaultSortDir="desc"
                  emptyMessage="No actions yet."
                  resetPageDependency={id}
                />
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </AppShell>
  );
}
