import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { BellRing, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EscalationRow {
  id: string;
  inwardId: string;
  escalatedTo: string;
  escalationReason?: string | null;
  escalatedAt: string;
  resolvedAt?: string | null;
}

export default function DakEscalations() {
  const { data: list, isLoading, isError } = useQuery<EscalationRow[]>({
    queryKey: ["/api/ioms/dak/escalations"],
  });

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Correspondence (M-09)", href: "/correspondence/inward" }, { label: "Escalations" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load dak escalations.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Correspondence (M-09)", href: "/correspondence/inward" }, { label: "Escalations" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BellRing className="h-5 w-5" />
            Dak escalations
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            SLA reminder and manual escalation records (yard-scoped). Open the inward file for context.
          </p>
          <div className="pt-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/correspondence/inward">All inward</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Inward</TableHead>
                  <TableHead>Escalated to</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Escalated at</TableHead>
                  <TableHead>Resolved</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(list ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-sm">
                      <Link href={`/correspondence/inward/${r.inwardId}`} className="text-primary hover:underline">
                        {r.inwardId}
                      </Link>
                    </TableCell>
                    <TableCell>{r.escalatedTo}</TableCell>
                    <TableCell className="max-w-[240px] truncate">{r.escalationReason ?? "—"}</TableCell>
                    <TableCell>{r.escalatedAt}</TableCell>
                    <TableCell>{r.resolvedAt ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!isLoading && (!list || list.length === 0) && (
            <p className="text-sm text-muted-foreground py-4">No escalations in your scope.</p>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
