import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FileCheck, AlertCircle } from "lucide-react";

interface Licence {
  id: string;
  licenceNo?: string | null;
  firmName: string;
  yardId: string;
  licenceType: string;
  mobile: string;
  validFrom?: string | null;
  validTo?: string | null;
  status: string;
  isBlocked?: boolean;
}

export default function TraderLicences() {
  const { data: licences, isLoading, isError } = useQuery<Licence[]>({
    queryKey: ["/api/ioms/traders/licences"],
  });
  const { data: yards = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/yards"],
  });
  const yardById = Object.fromEntries(yards.map((y) => [y.id, y.name]));

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Traders & Assets", href: "/traders/licences" }, { label: "Licences" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load licences.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Traders & Assets", href: "/traders/licences" }, { label: "Licences" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCheck className="h-5 w-5" />
            Trader Licences (M-02)
          </CardTitle>
          <p className="text-sm text-muted-foreground">IOMS licence lifecycle — Associated, Functionary, Hamali, Weighman, Assistant.</p>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Licence No</TableHead>
                  <TableHead>Firm</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Yard</TableHead>
                  <TableHead>Valid To</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(licences ?? []).map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-mono text-sm">
                      <Link href={`/traders/licences/${l.id}`} className="text-primary hover:underline">{l.licenceNo ?? l.id}</Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/traders/licences/${l.id}`} className="text-primary hover:underline">{l.firmName}</Link>
                    </TableCell>
                    <TableCell>{l.licenceType}</TableCell>
                    <TableCell>{yardById[l.yardId] ?? l.yardId}</TableCell>
                    <TableCell>{l.validTo ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={l.isBlocked ? "destructive" : l.status === "Active" ? "default" : "secondary"}>
                        {l.isBlocked ? "Blocked" : l.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!isLoading && (!licences || licences.length === 0) && (
            <p className="text-sm text-muted-foreground py-4">No IOMS licences. Existing traders are in Trader Directory.</p>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
