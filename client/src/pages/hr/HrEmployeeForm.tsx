import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { UserCircle, ArrowLeft, User, Lock, Settings, Loader2, AlertCircle } from "lucide-react";

interface Yard {
  id: string;
  code?: string | null;
  name?: string | null;
}
interface Employee {
  id: string;
  empId?: string | null;
  firstName: string;
  middleName?: string | null;
  surname: string;
  photoUrl?: string | null;
  designation: string;
  yardId: string;
  employeeType: string;
  aadhaarToken?: string | null;
  pan?: string | null;
  dob?: string | null;
  joiningDate: string;
  retirementDate?: string | null;
  mobile?: string | null;
  workEmail?: string | null;
  status: string;
  userId?: string | null;
}

const EMPLOYEE_TYPES = ["Regular", "Contract", "Daily Wage", "Temporary"];
const STATUS_OPTIONS = ["Active", "Inactive", "Suspended", "Retired", "Resigned"];

export default function HrEmployeeForm() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = !!id && id !== "new";

  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [surname, setSurname] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [designation, setDesignation] = useState("");
  const [yardId, setYardId] = useState("");
  const [employeeType, setEmployeeType] = useState("Regular");
  const [empId, setEmpId] = useState("");

  const [aadhaarToken, setAadhaarToken] = useState("");
  const [pan, setPan] = useState("");
  const [dob, setDob] = useState("");
  const [mobile, setMobile] = useState("");
  const [workEmail, setWorkEmail] = useState("");

  const [joiningDate, setJoiningDate] = useState("");
  const [retirementDate, setRetirementDate] = useState("");
  const [status, setStatus] = useState("Active");
  const [userId, setUserId] = useState("");

  const { data: yards = [] } = useQuery<Yard[]>({ queryKey: ["/api/yards"] });
  const { data: employee, isLoading, isError } = useQuery<Employee>({
    queryKey: ["/api/hr/employees", id],
    enabled: isEdit,
  });

  useEffect(() => {
    if (employee) {
      setFirstName(employee.firstName ?? "");
      setMiddleName(employee.middleName ?? "");
      setSurname(employee.surname ?? "");
      setPhotoUrl(employee.photoUrl ?? "");
      setDesignation(employee.designation ?? "");
      setYardId(employee.yardId ?? "");
      setEmployeeType(employee.employeeType ?? "Regular");
      setEmpId(employee.empId ?? "");
      setAadhaarToken(employee.aadhaarToken ?? "");
      setPan(employee.pan ?? "");
      setDob(employee.dob ?? "");
      setMobile(employee.mobile ?? "");
      setWorkEmail(employee.workEmail ?? "");
      setJoiningDate(employee.joiningDate ?? "");
      setRetirementDate(employee.retirementDate ?? "");
      setStatus(employee.status ?? "Active");
      setUserId(employee.userId ?? "");
    }
  }, [employee]);

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/hr/employees", {
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
      queryClient.invalidateQueries({ queryKey: ["/api/hr/employees"] });
      toast({ title: "Employee created" });
      setLocation(`/hr/employees/${row.id}`);
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/hr/employees/${id}`, {
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
      queryClient.invalidateQueries({ queryKey: ["/api/hr/employees"] });
      queryClient.invalidateQueries({ queryKey: ["/api/hr/employees", id] });
      toast({ title: "Employee updated" });
      setLocation(`/hr/employees/${id}`);
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      firstName,
      middleName: middleName || null,
      surname,
      photoUrl: photoUrl || null,
      designation,
      yardId,
      employeeType,
      empId: empId || null,
      aadhaarToken: aadhaarToken || null,
      pan: pan || null,
      dob: dob || null,
      mobile: mobile || null,
      workEmail: workEmail || null,
      joiningDate,
      retirementDate: retirementDate || null,
      status,
      userId: userId || null,
    };
    if (isEdit) updateMutation.mutate(payload);
    else createMutation.mutate(payload);
  };

  const pending = createMutation.isPending || updateMutation.isPending;

  if (isEdit && (isLoading || (employee === undefined && !isError))) {
    return (
      <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: "Edit employee" }]}>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-8 w-48 mb-4" />
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </AppShell>
    );
  }
  if (isEdit && (isError || !employee)) {
    return (
      <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: "Edit employee" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Employee not found.</span>
            <Button variant="outline" size="sm" onClick={() => setLocation("/hr/employees")}>Back</Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: isEdit ? "Edit employee" : "Add employee" }]}>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <UserCircle className="h-5 w-5" />
            {isEdit ? "Edit employee" : "Add employee"}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setLocation(isEdit ? `/hr/employees/${id}` : "/hr/employees")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <Tabs defaultValue="public">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="public"><User className="h-4 w-4 mr-2" /> Public info</TabsTrigger>
                <TabsTrigger value="personal"><Lock className="h-4 w-4 mr-2" /> Personal info</TabsTrigger>
                <TabsTrigger value="hr"><Settings className="h-4 w-4 mr-2" /> HR settings</TabsTrigger>
              </TabsList>
              <TabsContent value="public" className="space-y-4 pt-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div><Label>First name *</Label><Input value={firstName} onChange={(e) => setFirstName(e.target.value)} required /></div>
                  <div><Label>Middle name</Label><Input value={middleName} onChange={(e) => setMiddleName(e.target.value)} /></div>
                  <div><Label>Surname *</Label><Input value={surname} onChange={(e) => setSurname(e.target.value)} required /></div>
                  <div><Label>Photo URL</Label><Input value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://..." /></div>
                  <div><Label>Designation *</Label><Input value={designation} onChange={(e) => setDesignation(e.target.value)} required /></div>
                  <div><Label>Yard *</Label>
                    <Select value={yardId} onValueChange={setYardId} required>
                      <SelectTrigger><SelectValue placeholder="Select yard" /></SelectTrigger>
                      <SelectContent>
                        {(yards ?? []).map((y) => (
                          <SelectItem key={y.id} value={y.id}>{y.name ?? y.code ?? y.id}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Employee type</Label>
                    <Select value={employeeType} onValueChange={setEmployeeType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {EMPLOYEE_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {isEdit && (
                    <div><Label>Emp ID</Label><Input value={empId} onChange={(e) => setEmpId(e.target.value)} placeholder="EMP-LOC-YEAR-NNN" /></div>
                  )}
                </div>
              </TabsContent>
              <TabsContent value="personal" className="space-y-4 pt-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div><Label>Aadhaar (token / last 4)</Label><Input value={aadhaarToken} onChange={(e) => setAadhaarToken(e.target.value)} placeholder="Optional" /></div>
                  <div><Label>PAN</Label><Input value={pan} onChange={(e) => setPan(e.target.value)} /></div>
                  <div><Label>Date of birth</Label><Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} /></div>
                  <div><Label>Mobile</Label><Input value={mobile} onChange={(e) => setMobile(e.target.value)} /></div>
                  <div className="md:col-span-2"><Label>Work email</Label><Input type="email" value={workEmail} onChange={(e) => setWorkEmail(e.target.value)} /></div>
                </div>
              </TabsContent>
              <TabsContent value="hr" className="space-y-4 pt-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div><Label>Joining date *</Label><Input type="date" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} required /></div>
                  <div><Label>Retirement date</Label><Input type="date" value={retirementDate} onChange={(e) => setRetirementDate(e.target.value)} /></div>
                  <div><Label>Status</Label>
                    <Select value={status} onValueChange={setStatus}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>User ID (link to app user)</Label><Input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="Optional" /></div>
                </div>
              </TabsContent>
            </Tabs>
            <div className="flex justify-end gap-2 mt-6">
              <Button type="button" variant="outline" onClick={() => setLocation(isEdit ? `/hr/employees/${id}` : "/hr/employees")}>Cancel</Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {isEdit ? "Update" : "Create"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </AppShell>
  );
}
