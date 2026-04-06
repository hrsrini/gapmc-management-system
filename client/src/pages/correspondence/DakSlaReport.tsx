import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { AlertCircle, ClipboardList } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface InwardRow {
  id: string;
  diaryNo?: string | null;
  receivedDate: string;
  fromParty: string;
  subject: string;
  status: string;
  assignedTo?: string | null;
  deadline?: string | null;
}

interface SlaPayload {
  asOf: string;
  count: number;
  rows: InwardRow[];
}

export default function DakSlaReport() {
  const { data, isLoading, isError } = useQuery<SlaPayload>({
    queryKey: ["/api/ioms/dak/inward/sla-overdue"],
  });

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Correspondence (M-09)", href: "/correspondence/inward" }, { label: "SLA breach report" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load SLA breach list.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const rows = data?.rows ?? [];

  return (
    <AppShell breadcrumbs={[{ label: "Correspondence (M-09)", href: "/correspondence/inward" }, { label: "SLA breach report" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Dak SLA breach report
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Inward items with deadline on or before {data?.asOf ?? "—"} and status other than Closed. Escalations are created on the hourly SLA job when{" "}
            <code className="text-xs bg-muted px-1 rounded">sla_config</code> includes M-09/DAK.
          </p>
          {data != null && (
            <p className="text-sm font-medium pt-1">
              {data.count} overdue item(s)
            </p>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No overdue inward dak in your scope.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Diary</TableHead>
                  <TableHead>Deadline</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.diaryNo ?? "—"}</TableCell>
                    <TableCell>{r.deadline ?? "—"}</TableCell>
                    <TableCell className="max-w-[140px] truncate" title={r.fromParty}>{r.fromParty}</TableCell>
                    <TableCell className="max-w-[200px] truncate" title={r.subject}>{r.subject}</TableCell>
                    <TableCell><Badge variant="secondary">{r.status}</Badge></TableCell>
                    <TableCell>{r.assignedTo ?? "—"}</TableCell>
                    <TableCell>
                      <Link href={`/correspondence/inward/${r.id}`} className="text-sm text-primary underline">
                        Open
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
