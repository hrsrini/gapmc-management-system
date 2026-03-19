import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { HardHat, AlertCircle, PlusCircle } from "lucide-react";

interface Work {
  id: string;
  workNo?: string | null;
  yardId: string;
  workType: string;
  description?: string | null;
  contractorName?: string | null;
  status: string;
  startDate?: string | null;
  endDate?: string | null;
}

export default function ConstructionWorks() {
  const { can } = useAuth();
  const canCreate = can("M-08", "Create");
  const { data: list, isLoading, isError } = useQuery<Work[]>({
    queryKey: ["/api/ioms/works"],
  });
  const { data: yards = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/yards"],
  });
  const yardById = Object.fromEntries(yards.map((y) => [y.id, y.name]));

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Construction (M-08)", href: "/construction" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load works.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Construction (M-08)", href: "/construction" }]}>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <HardHat className="h-5 w-5" />
              Works (IOMS M-08)
            </CardTitle>
            <p className="text-sm text-muted-foreground">Works register, bills, AMC, land, fixed assets.</p>
          </div>
          {canCreate && (
            <Button asChild>
              <Link href="/construction/works/new"><PlusCircle className="h-4 w-4 mr-2" />Add work</Link>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Work No</TableHead>
                  <TableHead>Yard</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Contractor</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(list ?? []).map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-mono text-sm">
                      <Link href={`/construction/works/${w.id}`} className="text-primary hover:underline">{w.workNo ?? w.id}</Link>
                    </TableCell>
                    <TableCell>{yardById[w.yardId] ?? w.yardId}</TableCell>
                    <TableCell>{w.workType}</TableCell>
                    <TableCell>{w.contractorName ?? "—"}</TableCell>
                    <TableCell>{w.startDate ?? "—"}</TableCell>
                    <TableCell>{w.endDate ?? "—"}</TableCell>
                    <TableCell><Badge variant="secondary">{w.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!isLoading && (!list || list.length === 0) && (
            <p className="text-sm text-muted-foreground py-4">No works.</p>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
