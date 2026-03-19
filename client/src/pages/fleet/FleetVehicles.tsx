import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { Truck, AlertCircle, PlusCircle } from "lucide-react";

interface Vehicle {
  id: string;
  registrationNo: string;
  vehicleType: string;
  yardId: string;
  status: string;
  insuranceExpiry?: string | null;
  fitnessExpiry?: string | null;
}

export default function FleetVehicles() {
  const { can } = useAuth();
  const canCreate = can("M-07", "Create");
  const { data: list, isLoading, isError } = useQuery<Vehicle[]>({
    queryKey: ["/api/ioms/fleet/vehicles"],
  });
  const { data: yards = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ["/api/yards"],
  });
  const yardById = Object.fromEntries(yards.map((y) => [y.id, y.name]));

  if (isError) {
    return (
      <AppShell breadcrumbs={[{ label: "Fleet (M-07)", href: "/fleet" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Failed to load vehicles.</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Fleet (M-07)", href: "/fleet" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            Vehicles (IOMS M-07)
          </CardTitle>
          <p className="text-sm text-muted-foreground">Vehicle master, trip log, fuel, maintenance.</p>
          {canCreate && (
            <div className="pt-2">
              <Button asChild size="sm">
                <Link href="/fleet/vehicles/new"><PlusCircle className="h-4 w-4 mr-2" />Add vehicle</Link>
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
                  <TableHead>Registration</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Yard</TableHead>
                  <TableHead>Insurance</TableHead>
                  <TableHead>Fitness</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(list ?? []).map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-mono text-sm">
                      <Link href={`/fleet/vehicles/${v.id}`} className="text-primary hover:underline">{v.registrationNo}</Link>
                    </TableCell>
                    <TableCell>{v.vehicleType}</TableCell>
                    <TableCell>{yardById[v.yardId] ?? v.yardId}</TableCell>
                    <TableCell>{v.insuranceExpiry ?? "—"}</TableCell>
                    <TableCell>{v.fitnessExpiry ?? "—"}</TableCell>
                    <TableCell><Badge variant="secondary">{v.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {!isLoading && (!list || list.length === 0) && (
            <p className="text-sm text-muted-foreground py-4">No vehicles.</p>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
