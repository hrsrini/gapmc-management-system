import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Truck, ArrowLeft, Loader2, AlertCircle } from "lucide-react";

interface Yard {
  id: string;
  code?: string | null;
  name?: string | null;
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

export default function FleetVehicleForm() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = !!id;

  const [registrationNo, setRegistrationNo] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [yardId, setYardId] = useState("");
  const [status, setStatus] = useState("Active");
  const [capacity, setCapacity] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [purchaseValue, setPurchaseValue] = useState("");
  const [insuranceExpiry, setInsuranceExpiry] = useState("");
  const [fitnessExpiry, setFitnessExpiry] = useState("");

  const { data: yards = [] } = useQuery<Yard[]>({ queryKey: ["/api/yards"] });
  const { data: vehicle } = useQuery<Vehicle>({
    queryKey: ["/api/ioms/fleet/vehicles", id],
    enabled: isEdit,
  });

  useEffect(() => {
    if (vehicle) {
      setRegistrationNo(vehicle.registrationNo ?? "");
      setVehicleType(vehicle.vehicleType ?? "");
      setYardId(vehicle.yardId ?? "");
      setStatus(vehicle.status ?? "Active");
      setCapacity(vehicle.capacity ?? "");
      setPurchaseDate(vehicle.purchaseDate ?? "");
      setPurchaseValue(vehicle.purchaseValue != null ? String(vehicle.purchaseValue) : "");
      setInsuranceExpiry(vehicle.insuranceExpiry ?? "");
      setFitnessExpiry(vehicle.fitnessExpiry ?? "");
    }
  }, [vehicle]);

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/ioms/fleet/vehicles", {
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
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/fleet/vehicles"] });
      toast({ title: "Vehicle created" });
      setLocation(`/fleet/vehicles/${row.id}`);
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/ioms/fleet/vehicles/${id}`, {
        method: "PUT",
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
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/fleet/vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/fleet/vehicles", id] });
      toast({ title: "Vehicle updated" });
      setLocation(`/fleet/vehicles/${id}`);
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!registrationNo.trim() || !vehicleType.trim() || !yardId) {
      toast({ title: "Validation", description: "Fill registration, type and yard.", variant: "destructive" });
      return;
    }
    const body: Record<string, unknown> = {
      registrationNo: registrationNo.trim(),
      vehicleType: vehicleType.trim(),
      yardId,
      status,
      capacity: capacity.trim() || null,
      purchaseDate: purchaseDate.trim() || null,
      purchaseValue: purchaseValue ? Number(purchaseValue) : null,
      insuranceExpiry: insuranceExpiry.trim() || null,
      fitnessExpiry: fitnessExpiry.trim() || null,
    };
    if (isEdit) updateMutation.mutate(body);
    else createMutation.mutate(body);
  };

  const pending = createMutation.isPending || updateMutation.isPending;

  if (isEdit && vehicle === undefined) {
    return (
      <AppShell breadcrumbs={[{ label: "Fleet", href: "/fleet" }, { label: "Edit" }]}>
        <Card><CardContent className="p-6"><p className="text-muted-foreground">Loading…</p></CardContent></Card>
      </AppShell>
    );
  }
  if (isEdit && vehicle === null) {
    return (
      <AppShell breadcrumbs={[{ label: "Fleet", href: "/fleet" }, { label: "Edit" }]}>
        <Card className="bg-destructive/10"><CardContent className="p-6 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-destructive" />
          <span>Vehicle not found.</span>
          <Button variant="outline" size="sm" onClick={() => setLocation("/fleet")}>Back</Button>
        </CardContent></Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "Fleet", href: "/fleet" }, { label: isEdit ? "Edit vehicle" : "Add vehicle" }]}>
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            {isEdit ? "Edit vehicle" : "Add vehicle"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Registration no *</Label>
                <Input value={registrationNo} onChange={(e) => setRegistrationNo(e.target.value)} placeholder="e.g. GA-01-AB-1234" required disabled={isEdit} />
              </div>
              <div className="space-y-2">
                <Label>Vehicle type *</Label>
                <Input value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} placeholder="e.g. Light, Truck" required />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Yard *</Label>
                <Select value={yardId} onValueChange={setYardId} required>
                  <SelectTrigger><SelectValue placeholder="Select yard" /></SelectTrigger>
                  <SelectContent>
                    {(yards as Yard[]).map((y) => (
                      <SelectItem key={y.id} value={y.id}>{y.name ?? y.code ?? y.id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="UnderRepair">Under repair</SelectItem>
                    <SelectItem value="Decommissioned">Decommissioned</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Capacity</Label>
                <Input value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="e.g. 2T" />
              </div>
              <div className="space-y-2">
                <Label>Purchase date</Label>
                <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Purchase value</Label>
                <Input type="number" min="0" value={purchaseValue} onChange={(e) => setPurchaseValue(e.target.value)} placeholder="0" />
              </div>
              <div className="space-y-2">
                <Label>Insurance expiry</Label>
                <Input type="date" value={insuranceExpiry} onChange={(e) => setInsuranceExpiry(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Fitness expiry</Label>
              <Input type="date" value={fitnessExpiry} onChange={(e) => setFitnessExpiry(e.target.value)} />
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {isEdit ? "Update" : "Create"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setLocation(isEdit ? `/fleet/vehicles/${id}` : "/fleet")}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Back
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </AppShell>
  );
}
