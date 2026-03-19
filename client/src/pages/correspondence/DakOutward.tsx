import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { Send, AlertCircle, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Outward {
  id: string;
  despatchNo?: string | null;
  despatchDate: string;
  toParty: string;
  subject: string;
  modeOfDespatch: string;
  toAddress?: string | null;
  inwardRefId?: string | null;
  despatchedBy?: string | null;
}

export default function DakOutward() {
  const { data: list, isLoading, isError } = useQuery<Outward[]>({
    queryKey: ["/api/ioms/dak/outward"],
  });

  const { can } = useAuth();
  const canCreate = can("M-09", "Create");

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Correspondence (M-09)", href: "/correspondence/outward" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load outward dak.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Correspondence (M-09)", href: "/correspondence/outward" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Dak Outward (IOMS M-09)
          </CardTitle>
          <p className="text-sm text-muted-foreground">Outward correspondence — despatch no, to party, subject, mode.</p>
          {canCreate && (
            <div className="pt-2">
              <Button asChild size="sm">
                <Link href="/correspondence/outward/new"><PlusCircle className="h-4 w-4 mr-2" />Add outward</Link>
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
                  <TableHead>Despatch No</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Despatched by</TableHead>
                  <TableHead>Inward ref</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(list ?? []).map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-mono text-sm">{d.despatchNo ?? "—"}</TableCell>
                    <TableCell>{d.despatchDate}</TableCell>
                    <TableCell>{d.toParty}</TableCell>
                    <TableCell className="max-w-[200px] truncate">{d.subject}</TableCell>
                    <TableCell>{d.modeOfDespatch}</TableCell>
                    <TableCell>{d.despatchedBy ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{d.inwardRefId ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!isLoading && (!list || list.length === 0) && (
            <p className="text-sm text-muted-foreground py-4">No outward dak.</p>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
