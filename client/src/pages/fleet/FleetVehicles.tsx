import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { Truck, AlertCircle, PlusCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";

interface Vehicle {
  id: string;
  registrationNo: string;
  vehicleType: string;
  yardId: string;
  status: string;
  insuranceExpiry?: string | null;
  fitnessExpiry?: string | null;
}

interface FleetRenewalAlert {
  vehicleId: string;
  registrationNo: string;
  kind: "insurance" | "fitness";
  expiryDate: string;
  daysRemaining: number;
  urgency: "overdue" | "30d" | "60d";
}

const columns: ReportTableColumn[] = [
  { key: "_reg", header: "Registration", sortField: "registrationNo" },
  { key: "vehicleType", header: "Type" },
  { key: "yardName", header: "Yard" },
  { key: "insuranceExpiry", header: "Insurance" },
  { key: "fitnessExpiry", header: "Fitness" },
  { key: "_status", header: "Status", sortField: "status" },
];

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

  const { data: renewalPayload } = useQuery<{ alerts: FleetRenewalAlert[] }>({
    queryKey: ["/api/ioms/fleet/renewal-alerts"],
  });
  const fleetAlerts = renewalPayload?.alerts ?? [];
  const overdueFleet = fleetAlerts.filter((a) => a.urgency === "overdue").length;

  const sourceRows = useMemo((): Record<string, unknown>[] => {
    return (list ?? []).map((v) => ({
      id: v.id,
      registrationNo: v.registrationNo,
      _reg: (
        <Link href={`/fleet/vehicles/${v.id}`} className="font-mono text-sm text-primary hover:underline">
          {v.registrationNo}
        </Link>
      ),
      vehicleType: v.vehicleType,
      yardName: yardById[v.yardId] ?? v.yardId,
      insuranceExpiry: v.insuranceExpiry ?? "—",
      fitnessExpiry: v.fitnessExpiry ?? "—",
      status: v.status,
      _status: <Badge variant="secondary">{v.status}</Badge>,
    }));
  }, [list, yardById]);

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
          {fleetAlerts.length > 0 && (
            <Alert variant={overdueFleet > 0 ? "destructive" : "default"} className="mt-3">
              <AlertTitle>Renewal reminders</AlertTitle>
              <AlertDescription>
                {fleetAlerts.length} insurance/fitness item(s) due within 60 days or overdue
                {overdueFleet > 0 ? ` (${overdueFleet} overdue).` : "."} Review registration and expiry columns below.
              </AlertDescription>
            </Alert>
          )}
          {canCreate && (
            <div className="pt-2">
              <Button asChild size="sm">
                <Link href="/fleet/vehicles/new">
                  <PlusCircle className="h-4 w-4 mr-2" />
                  Add vehicle
                </Link>
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ClientDataGrid
              columns={columns}
              sourceRows={sourceRows}
              searchKeys={["registrationNo", "vehicleType", "yardName", "insuranceExpiry", "fitnessExpiry", "status"]}
              searchPlaceholder="Search by registration, type, yard, expiry, status…"
              defaultSortKey="registrationNo"
              defaultSortDir="asc"
              emptyMessage="No vehicles."
            />
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
