import { useState, useEffect, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClientDataGrid } from "@/components/reports/ClientDataGrid";
import type { ReportTableColumn } from "@/components/reports/ReportDataTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { Truck, ArrowLeft, Pencil, Route, Fuel, Wrench, AlertCircle, Plus, Loader2 } from "lucide-react";
import { formatYmdToDisplay } from "@/lib/dateFormat";

function TripForm({
  vehicleId,
  onSubmit,
  onCancel,
  saving,
}: {
  vehicleId: string;
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [tripDate, setTripDate] = useState("");
  const [purpose, setPurpose] = useState("");
  const [route, setRoute] = useState("");
  const [distanceKm, setDistanceKm] = useState("");
  const [fuelConsumed, setFuelConsumed] = useState("");
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      tripDate: tripDate || undefined,
      purpose: purpose || undefined,
      route: route || undefined,
      distanceKm: distanceKm ? Number(distanceKm) : undefined,
      fuelConsumed: fuelConsumed ? Number(fuelConsumed) : undefined,
    });
  };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div><Label>Trip date *</Label><Input type="date" value={tripDate} onChange={(e) => setTripDate(e.target.value)} required /></div>
      <div><Label>Purpose</Label><Input value={purpose} onChange={(e) => setPurpose(e.target.value)} /></div>
      <div><Label>Route</Label><Input value={route} onChange={(e) => setRoute(e.target.value)} /></div>
      <div><Label>Distance (km)</Label><Input type="number" step="0.01" value={distanceKm} onChange={(e) => setDistanceKm(e.target.value)} /></div>
      <div><Label>Fuel consumed</Label><Input type="number" step="0.01" value={fuelConsumed} onChange={(e) => setFuelConsumed(e.target.value)} /></div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Add</Button>
      </DialogFooter>
    </form>
  );
}

function FuelForm({
  vehicleId,
  onSubmit,
  onCancel,
  saving,
}: {
  vehicleId: string;
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [fuelDate, setFuelDate] = useState("");
  const [quantityLitres, setQuantityLitres] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      fuelDate: fuelDate || undefined,
      quantityLitres: quantityLitres ? Number(quantityLitres) : 0,
      totalAmount: totalAmount ? Number(totalAmount) : undefined,
    });
  };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div><Label>Fuel date *</Label><Input type="date" value={fuelDate} onChange={(e) => setFuelDate(e.target.value)} required /></div>
      <div><Label>Quantity (litres) *</Label><Input type="number" step="0.01" value={quantityLitres} onChange={(e) => setQuantityLitres(e.target.value)} required /></div>
      <div><Label>Total amount</Label><Input type="number" step="0.01" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} /></div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Add</Button>
      </DialogFooter>
    </form>
  );
}

function MaintForm({
  vehicleId,
  onSubmit,
  onCancel,
  saving,
}: {
  vehicleId: string;
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [serviceDate, setServiceDate] = useState("");
  const [maintenanceType, setMaintenanceType] = useState("");
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState("");
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      serviceDate: serviceDate || undefined,
      maintenanceType: maintenanceType || undefined,
      description: description || undefined,
      cost: cost ? Number(cost) : undefined,
    });
  };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div><Label>Service date *</Label><Input type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} required /></div>
      <div><Label>Type *</Label><Input value={maintenanceType} onChange={(e) => setMaintenanceType(e.target.value)} required /></div>
      <div><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      <div><Label>Cost</Label><Input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Add</Button>
      </DialogFooter>
    </form>
  );
}

interface Vehicle {
  id: string;
  registrationNo: string;
  vehicleType: string;
  yardId: string;
  status: string;
  capacity?: string | null;
  purchaseDate?: string | null;
  purchaseValue?: number | null;
  insuranceExpiry?: string | null;
  fitnessExpiry?: string | null;
}
interface Trip {
  id: string;
  tripDate: string;
  purpose?: string | null;
  route?: string | null;
  distanceKm?: number | null;
  fuelConsumed?: number | null;
}
interface FuelEntry {
  id: string;
  fuelDate: string;
  quantityLitres: number;
  totalAmount?: number | null;
}
interface MaintenanceEntry {
  id: string;
  serviceDate: string;
  maintenanceType: string;
  description?: string | null;
  cost?: number | null;
}
interface YardRef {
  id: string;
  name: string;
}

const tripColumns: ReportTableColumn[] = [
  { key: "tripDate", header: "Date" },
  { key: "purpose", header: "Purpose" },
  { key: "route", header: "Route" },
  { key: "distanceKm", header: "Distance (km)", sortField: "distanceKmNum" },
  { key: "fuelConsumed", header: "Fuel", sortField: "fuelConsumedNum" },
];

const fuelColumns: ReportTableColumn[] = [
  { key: "fuelDate", header: "Date" },
  { key: "quantityLitres", header: "Quantity (L)", sortField: "quantityLitres" },
  { key: "totalAmount", header: "Amount", sortField: "totalAmountNum" },
];

const maintColumns: ReportTableColumn[] = [
  { key: "serviceDate", header: "Date" },
  { key: "maintenanceType", header: "Type" },
  { key: "description", header: "Description" },
  { key: "cost", header: "Cost", sortField: "costNum" },
];

export default function FleetVehicleDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = useAuth();
  const canUpdate = can("M-07", "Update");
  const canCreate = can("M-07", "Create");
  const [tripOpen, setTripOpen] = useState(false);
  const [fuelOpen, setFuelOpen] = useState(false);
  const [maintOpen, setMaintOpen] = useState(false);

  const { data: vehicle, isLoading, isError } = useQuery<Vehicle>({
    queryKey: ["/api/ioms/fleet/vehicles", id],
    enabled: !!id,
  });
  const { data: trips = [] } = useQuery<Trip[]>({
    queryKey: [`/api/ioms/fleet/vehicles/${id}/trips`],
    enabled: !!id && !!vehicle,
  });
  const { data: fuelEntries = [] } = useQuery<FuelEntry[]>({
    queryKey: [`/api/ioms/fleet/vehicles/${id}/fuel`],
    enabled: !!id && !!vehicle,
  });
  const { data: maintenanceEntries = [] } = useQuery<MaintenanceEntry[]>({
    queryKey: [`/api/ioms/fleet/vehicles/${id}/maintenance`],
    enabled: !!id && !!vehicle,
  });
  const { data: yards = [] } = useQuery<YardRef[]>({
    queryKey: ["/api/yards"],
  });
  const yardById = Object.fromEntries(yards.map((y) => [y.id, y.name]));

  const tripRows = useMemo((): Record<string, unknown>[] => {
    return trips.map((t) => ({
      id: t.id,
      tripDate: t.tripDate,
      purpose: t.purpose ?? "—",
      route: t.route ?? "—",
      distanceKm: t.distanceKm ?? "—",
      distanceKmNum: t.distanceKm ?? null,
      fuelConsumed: t.fuelConsumed ?? "—",
      fuelConsumedNum: t.fuelConsumed ?? null,
    }));
  }, [trips]);

  const fuelRows = useMemo((): Record<string, unknown>[] => {
    return fuelEntries.map((f) => ({
      id: f.id,
      fuelDate: f.fuelDate,
      quantityLitres: f.quantityLitres,
      totalAmount: f.totalAmount != null ? `₹${f.totalAmount}` : "—",
      totalAmountNum: f.totalAmount ?? null,
    }));
  }, [fuelEntries]);

  const maintRows = useMemo((): Record<string, unknown>[] => {
    return maintenanceEntries.map((m) => ({
      id: m.id,
      serviceDate: m.serviceDate,
      maintenanceType: m.maintenanceType,
      description: m.description ?? "—",
      cost: m.cost != null ? `₹${m.cost}` : "—",
      costNum: m.cost ?? null,
    }));
  }, [maintenanceEntries]);

  const invalidateVehicleLists = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/ioms/fleet/vehicles/${id}/trips`] });
    queryClient.invalidateQueries({ queryKey: [`/api/ioms/fleet/vehicles/${id}/fuel`] });
    queryClient.invalidateQueries({ queryKey: [`/api/ioms/fleet/vehicles/${id}/maintenance`] });
  };

  const tripMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/ioms/fleet/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, vehicleId: id }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      invalidateVehicleLists();
      toast({ title: "Trip added" });
      setTripOpen(false);
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const fuelMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/ioms/fleet/fuel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, vehicleId: id }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      invalidateVehicleLists();
      toast({ title: "Fuel entry added" });
      setFuelOpen(false);
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });
  const maintMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/ioms/fleet/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, vehicleId: id }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      invalidateVehicleLists();
      toast({ title: "Maintenance entry added" });
      setMaintOpen(false);
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  useEffect(() => {
    if (!id) setLocation("/fleet");
  }, [id, setLocation]);
  if (!id) return null;
  if (isError || (!isLoading && !vehicle)) {
    return (
      <AppShell breadcrumbs={[{ label: "Fleet", href: "/fleet" }, { label: "Vehicle" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Vehicle not found.</span>
            <Button variant="outline" size="sm" onClick={() => setLocation("/fleet")}>Back to list</Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Fleet", href: "/fleet" }, { label: vehicle?.registrationNo ?? id }]}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/fleet")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          {vehicle && canUpdate && (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/fleet/vehicles/${id}/edit`}><Pencil className="h-4 w-4 mr-1" /> Edit</Link>
            </Button>
          )}
        </div>
        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : vehicle ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Truck className="h-5 w-5" />
                  {vehicle.registrationNo} — <Badge variant="secondary">{vehicle.status}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><span className="text-muted-foreground">Type</span><p className="font-medium">{vehicle.vehicleType}</p></div>
                <div><span className="text-muted-foreground">Yard</span><p className="font-medium">{yardById[vehicle.yardId] ?? vehicle.yardId}</p></div>
                {vehicle.capacity && <div><span className="text-muted-foreground">Capacity</span><p>{vehicle.capacity}</p></div>}
                {vehicle.purchaseDate && (
                  <div>
                    <span className="text-muted-foreground">Purchase date</span>
                    <p>{formatYmdToDisplay(vehicle.purchaseDate)}</p>
                  </div>
                )}
                {vehicle.purchaseValue != null && <div><span className="text-muted-foreground">Purchase value</span><p>₹{vehicle.purchaseValue}</p></div>}
                {vehicle.insuranceExpiry && (
                  <div>
                    <span className="text-muted-foreground">Insurance expiry</span>
                    <p>{formatYmdToDisplay(vehicle.insuranceExpiry)}</p>
                  </div>
                )}
                {vehicle.fitnessExpiry && (
                  <div>
                    <span className="text-muted-foreground">Fitness expiry</span>
                    <p>{formatYmdToDisplay(vehicle.fitnessExpiry)}</p>
                  </div>
                )}
              </CardContent>
            </Card>
            <Tabs defaultValue="trips" className="w-full">
              <TabsList>
                <TabsTrigger value="trips"><Route className="h-4 w-4 mr-2" /> Trips ({trips.length})</TabsTrigger>
                <TabsTrigger value="fuel"><Fuel className="h-4 w-4 mr-2" /> Fuel ({fuelEntries.length})</TabsTrigger>
                <TabsTrigger value="maintenance"><Wrench className="h-4 w-4 mr-2" /> Maintenance ({maintenanceEntries.length})</TabsTrigger>
              </TabsList>
              <TabsContent value="trips" className="mt-4">
                <Card>
                  <CardContent className="pt-4">
                    {canCreate && (
                    <div className="flex justify-end mb-2">
                      <Dialog open={tripOpen} onOpenChange={setTripOpen}>
                        <DialogTrigger asChild>
                          <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add trip</Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader><DialogTitle>Add trip</DialogTitle></DialogHeader>
                          <TripForm vehicleId={id!} onSubmit={(body) => tripMutation.mutate(body)} onCancel={() => setTripOpen(false)} saving={tripMutation.isPending} />
                        </DialogContent>
                      </Dialog>
                    </div>
                    )}
                    <ClientDataGrid
                      columns={tripColumns}
                      sourceRows={tripRows}
                      searchKeys={["tripDate", "purpose", "route", "distanceKm", "fuelConsumed"]}
                      searchPlaceholder="Search trips…"
                      defaultSortKey="tripDate"
                      defaultSortDir="desc"
                      resetPageDependency={id}
                      emptyMessage="No trip records."
                    />
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="fuel" className="mt-4">
                <Card>
                  <CardContent className="pt-4">
                    {canCreate && (
                    <div className="flex justify-end mb-2">
                      <Dialog open={fuelOpen} onOpenChange={setFuelOpen}>
                        <DialogTrigger asChild>
                          <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add fuel</Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader><DialogTitle>Add fuel entry</DialogTitle></DialogHeader>
                          <FuelForm vehicleId={id!} onSubmit={(body) => fuelMutation.mutate(body)} onCancel={() => setFuelOpen(false)} saving={fuelMutation.isPending} />
                        </DialogContent>
                      </Dialog>
                    </div>
                    )}
                    <ClientDataGrid
                      columns={fuelColumns}
                      sourceRows={fuelRows}
                      searchKeys={["fuelDate", "quantityLitres", "totalAmount"]}
                      searchPlaceholder="Search fuel entries…"
                      defaultSortKey="fuelDate"
                      defaultSortDir="desc"
                      resetPageDependency={id}
                      emptyMessage="No fuel records."
                    />
                  </CardContent>
                </Card>
              </TabsContent>
              <TabsContent value="maintenance" className="mt-4">
                <Card>
                  <CardContent className="pt-4">
                    {canCreate && (
                    <div className="flex justify-end mb-2">
                      <Dialog open={maintOpen} onOpenChange={setMaintOpen}>
                        <DialogTrigger asChild>
                          <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add maintenance</Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader><DialogTitle>Add maintenance</DialogTitle></DialogHeader>
                          <MaintForm vehicleId={id!} onSubmit={(body) => maintMutation.mutate(body)} onCancel={() => setMaintOpen(false)} saving={maintMutation.isPending} />
                        </DialogContent>
                      </Dialog>
                    </div>
                    )}
                    <ClientDataGrid
                      columns={maintColumns}
                      sourceRows={maintRows}
                      searchKeys={["serviceDate", "maintenanceType", "description", "cost"]}
                      searchPlaceholder="Search maintenance…"
                      defaultSortKey="serviceDate"
                      defaultSortDir="desc"
                      resetPageDependency={id}
                      emptyMessage="No maintenance records."
                    />
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
