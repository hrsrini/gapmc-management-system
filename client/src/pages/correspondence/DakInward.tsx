import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { Mail, AlertCircle, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  const { data: list, isLoading, isError } = useQuery<Inward[]>({
    queryKey: ["/api/ioms/dak/inward"],
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
          <p className="text-sm text-muted-foreground">Inward correspondence — diary no, routing, action log, escalation.</p>
          {canCreate && (
            <div className="pt-2">
              <Button asChild size="sm">
                <Link href="/correspondence/inward/new"><PlusCircle className="h-4 w-4 mr-2" />Add inward</Link>
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Diary No</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead>Deadline</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(list ?? []).map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-mono text-sm">
                      <Link href={`/correspondence/inward/${d.id}`} className="text-primary hover:underline">{d.diaryNo ?? d.id}</Link>
                    </TableCell>
                    <TableCell>{d.receivedDate}</TableCell>
                    <TableCell>{d.fromParty}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{d.subject}</TableCell>
                    <TableCell>{d.modeOfReceipt}</TableCell>
                    <TableCell>{d.assignedTo ?? "—"}</TableCell>
                    <TableCell>{d.deadline ?? "—"}</TableCell>
                    <TableCell><Badge variant="secondary">{d.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!isLoading && (!list || list.length === 0) && (
            <p className="text-sm text-muted-foreground py-4">No inward dak.</p>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
