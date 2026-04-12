import { useState, useEffect, useMemo } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { UserCircle, ArrowLeft, User, Lock, Settings, Loader2, AlertCircle, KeyRound } from "lucide-react";
import { EmployeeLoginAccessSection } from "@/components/hr/EmployeeLoginAccessSection";
import { isValidEmailFormat, isStrictAadhaar12Digits, parseIndianMobile10Digits } from "@shared/india-validation";

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
  personalEmail?: string | null;
  status: string;
  userId?: string | null;
}

interface Role {
  id: string;
  name: string;
  tier: string;
}

const EMPLOYEE_TYPES = ["Regular", "Contract", "Daily Wage", "Temporary"];
const STATUS_OPTIONS = ["Draft", "Submitted", "Active", "Inactive", "Suspended", "Retired", "Resigned"];

export default function HrEmployeeForm() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { can, user } = useAuth();
  const canM10Create = can("M-10", "Create");
  const canM10Read = can("M-10", "Read");
  const canApproveRegistration =
    can("M-01", "Approve") || Boolean(user?.roles?.some((r) => r.tier === "DA" || r.tier === "ADMIN"));
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
  const [personalEmail, setPersonalEmail] = useState("");

  const [joiningDate, setJoiningDate] = useState("");
  const [retirementDate, setRetirementDate] = useState("");
  const [status, setStatus] = useState("Draft");

  const [enableLoginOnCreate, setEnableLoginOnCreate] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginConfirm, setLoginConfirm] = useState("");
  const [createRoleIds, setCreateRoleIds] = useState<Set<string>>(new Set());
  const [createYardIds, setCreateYardIds] = useState<Set<string>>(new Set());

  const { data: yards = [] } = useQuery<Yard[]>({ queryKey: ["/api/yards"] });
  const { data: employee, isLoading, isError } = useQuery<Employee>({
    queryKey: ["/api/hr/employees", id],
    enabled: isEdit,
  });

  const { data: roles = [] } = useQuery<Role[]>({
    queryKey: ["/api/admin/roles"],
    enabled: !isEdit && canM10Create,
  });
  const { data: adminYards = [] } = useQuery<Array<{ id: string; name: string; isActive?: boolean | null }>>({
    queryKey: ["/api/admin/yards"],
    enabled: !isEdit && canM10Create && enableLoginOnCreate,
  });
  const activeAdminYards = useMemo(() => adminYards.filter((y) => y.isActive !== false), [adminYards]);

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
      setPersonalEmail(employee.personalEmail ?? "");
      setJoiningDate(employee.joiningDate ?? "");
      setRetirementDate(employee.retirementDate ?? "");
      setStatus(employee.status ?? "Active");
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
      return (await res.json()) as Employee;
    },
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/hr/employees/${id}/approve-registration`, {
        method: "POST",
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
      toast({ title: "Registration approved", description: "EMP-ID assigned and status set to Active." });
      setLocation(`/hr/employees/${id}`);
    },
    onError: (e: Error) => toast({ title: "Approval failed", description: e.message, variant: "destructive" }),
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

  function toggleCreateRole(roleId: string) {
    setCreateRoleIds((prev) => {
      const n = new Set(prev);
      if (n.has(roleId)) n.delete(roleId);
      else n.add(roleId);
      return n;
    });
  }

  function toggleCreateYard(yid: string) {
    setCreateYardIds((prev) => {
      const n = new Set(prev);
      if (n.has(yid)) n.delete(yid);
      else n.add(yid);
      return n;
    });
  }

  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pe = personalEmail.trim() ? personalEmail.trim().toLowerCase() : null;
    if (pe && !isValidEmailFormat(pe)) {
      toast({ title: "Invalid personal email", description: "Please enter a valid email address.", variant: "destructive" });
      return;
    }
    const we = workEmail.trim() ? workEmail.trim().toLowerCase() : null;
    if (we && !isValidEmailFormat(we)) {
      toast({ title: "Invalid work email", description: "Please enter a valid email address.", variant: "destructive" });
      return;
    }
    let mobileNorm: string | null = null;
    if (mobile.trim()) {
      const m = parseIndianMobile10Digits(mobile);
      if (!m) {
        toast({ title: "Invalid mobile", description: "Use a valid 10-digit Indian mobile number.", variant: "destructive" });
        return;
      }
      mobileNorm = m;
    }
    const aadhaarTrim = aadhaarToken.trim();
    if (aadhaarTrim) {
      const masked = /^XXXX-XXXX-\d{4}$/i.test(aadhaarTrim);
      if (!masked && !isStrictAadhaar12Digits(aadhaarTrim)) {
        toast({
          title: "Invalid Aadhaar",
          description: "Enter exactly 12 digits with no spaces, or the stored masked value.",
          variant: "destructive",
        });
        return;
      }
    }

    const payload: Record<string, unknown> = {
      firstName,
      middleName: middleName || null,
      surname,
      photoUrl: photoUrl || null,
      designation,
      yardId,
      employeeType,
      aadhaarToken: aadhaarTrim || null,
      pan: pan || null,
      dob: dob || null,
      mobile: mobileNorm,
      workEmail: we,
      personalEmail: pe,
      joiningDate,
      retirementDate: retirementDate || null,
      status,
    };

    if (isEdit) {
      updateMutation.mutate(payload);
      return;
    }

    setSubmitting(true);
    try {
      const emp = await createMutation.mutateAsync(payload);
      queryClient.invalidateQueries({ queryKey: ["/api/hr/employees"] });

      if (enableLoginOnCreate && canM10Create) {
        if (status !== "Active") {
          toast({
            title: "Employee created",
            description: "Login was not created because status is not Active. Use Login & roles on the employee page when active.",
          });
          setLocation(`/hr/employees/${emp.id}`);
          return;
        }
        const email = loginEmail.trim() || workEmail.trim();
        if (!email) {
          toast({
            title: "Employee created",
            description: "Set work email or sign-in email and create login from the employee page.",
          });
          setLocation(`/hr/employees/${emp.id}`);
          return;
        }
        if (!isValidEmailFormat(email)) {
          toast({
            title: "Employee created",
            description: "Sign-in email must be a valid email address. Finish login on the employee page.",
            variant: "destructive",
          });
          setLocation(`/hr/employees/${emp.id}`);
          return;
        }
        if (loginPassword.length < 8 || loginPassword !== loginConfirm) {
          toast({
            title: "Employee created",
            description: "Password must be at least 8 characters and match confirmation. Finish login on the employee page.",
          });
          setLocation(`/hr/employees/${emp.id}`);
          return;
        }
        const displayName = [firstName, middleName, surname].filter(Boolean).join(" ").trim() || email;
        const res = await fetch(`/api/hr/employees/${emp.id}/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            name: displayName,
            username: loginUsername.trim() || undefined,
            password: loginPassword,
            roleIds: Array.from(createRoleIds),
            yardIds: Array.from(createYardIds),
          }),
          credentials: "include",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast({
            title: "Employee created; login failed",
            description: (data as { error?: string }).error ?? res.statusText,
            variant: "destructive",
          });
          setLocation(`/hr/employees/${emp.id}`);
          return;
        }
        queryClient.invalidateQueries({ queryKey: ["/api/hr/employees"] });
        queryClient.invalidateQueries({ queryKey: [`/api/hr/employees/${emp.id}/login-profile`] });
        toast({ title: "Employee and app login created" });
        setLocation(`/hr/employees/${emp.id}`);
        return;
      }

      toast({ title: "Employee created" });
      setLocation(`/hr/employees/${emp.id}`);
    } catch (err) {
      toast({
        title: "Create failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const pending = submitting || updateMutation.isPending;
  const showAccessTab = (!isEdit && canM10Create) || (isEdit && canM10Read);
  const displayNameForAccess = [firstName, middleName, surname].filter(Boolean).join(" ").trim();

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
              <TabsList className={`grid w-full gap-1 ${showAccessTab ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
                <TabsTrigger value="public"><User className="h-4 w-4 mr-2 shrink-0" /> Public info</TabsTrigger>
                <TabsTrigger value="personal"><Lock className="h-4 w-4 mr-2 shrink-0" /> Personal info</TabsTrigger>
                <TabsTrigger value="hr"><Settings className="h-4 w-4 mr-2 shrink-0" /> HR settings</TabsTrigger>
                {showAccessTab && (
                  <TabsTrigger value="access"><KeyRound className="h-4 w-4 mr-2 shrink-0" /> App access</TabsTrigger>
                )}
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
                    <div className="md:col-span-2">
                      <Label>Employee ID (EMP-NNN)</Label>
                      <Input value={empId || "— (assigned at DA approval)"} readOnly disabled className="bg-muted/50" />
                      <p className="text-xs text-muted-foreground mt-1">
                        Official ID is assigned only when a Data Approver approves registration (BR-EMP-06).
                      </p>
                    </div>
                  )}
                </div>
              </TabsContent>
              <TabsContent value="personal" className="space-y-4 pt-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Aadhaar number</Label>
                    <Input
                      value={aadhaarToken}
                      onChange={(e) => setAadhaarToken(e.target.value)}
                      placeholder="12 digits, no spaces (stored masked)"
                      inputMode="numeric"
                      autoComplete="off"
                    />
                  </div>
                  <div><Label>PAN</Label><Input value={pan} onChange={(e) => setPan(e.target.value)} /></div>
                  <div><Label>Date of birth</Label><Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} /></div>
                  <div><Label>Mobile</Label><Input value={mobile} onChange={(e) => setMobile(e.target.value)} /></div>
                  <div><Label>Personal email</Label><Input type="email" value={personalEmail} onChange={(e) => setPersonalEmail(e.target.value)} placeholder="Must be unique among active / pending employees" /></div>
                  <div><Label>Work email</Label><Input type="email" value={workEmail} onChange={(e) => setWorkEmail(e.target.value)} /></div>
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
                </div>
                <p className="text-xs text-muted-foreground">
                  New employees start as Draft or Submitted; a Data Approver assigns <span className="font-medium">EMP-NNN</span> and activates the record. App login is linked from the <span className="font-medium">App access</span> tab when status is Active.
                </p>
              </TabsContent>
              {showAccessTab && (
                <TabsContent value="access" className="space-y-4 pt-4">
                  {!isEdit && canM10Create && (
                    <div className="space-y-4 rounded-lg border p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <Label className="text-base">Create app login with this employee</Label>
                          <p className="text-xs text-muted-foreground mt-1">
                            Optional. Saves the employee first, then creates the IOMS user linked to this record (same as employee detail → Login &amp; roles).
                          </p>
                        </div>
                        <Switch checked={enableLoginOnCreate} onCheckedChange={setEnableLoginOnCreate} />
                      </div>
                      {enableLoginOnCreate && (
                        <div className="space-y-4 border-t pt-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <Label>Sign-in email *</Label>
                              <Input
                                type="email"
                                value={loginEmail}
                                onChange={(e) => setLoginEmail(e.target.value)}
                                placeholder={workEmail ? "Defaults to work email if empty" : "required if no work email"}
                              />
                            </div>
                            <div>
                              <Label>Username (optional)</Label>
                              <Input value={loginUsername} onChange={(e) => setLoginUsername(e.target.value)} placeholder="Alias for login" />
                            </div>
                            <div>
                              <Label>Password *</Label>
                              <Input type="password" autoComplete="new-password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} minLength={8} />
                            </div>
                            <div>
                              <Label>Confirm password *</Label>
                              <Input type="password" autoComplete="new-password" value={loginConfirm} onChange={(e) => setLoginConfirm(e.target.value)} minLength={8} />
                            </div>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="rounded-md border">
                              <div className="border-b bg-muted/40 px-3 py-2 text-sm font-medium">Roles</div>
                              <div className="p-3 space-y-2 max-h-40 overflow-y-auto">
                                {roles.map((r) => (
                                  <label key={r.id} className="flex items-center gap-2 text-sm cursor-pointer">
                                    <Checkbox checked={createRoleIds.has(r.id)} onCheckedChange={() => toggleCreateRole(r.id)} />
                                    <span>{r.name} <span className="text-muted-foreground">({r.tier})</span></span>
                                  </label>
                                ))}
                              </div>
                            </div>
                            <div className="rounded-md border">
                              <div className="border-b bg-muted/40 px-3 py-2 text-sm font-medium">Locations (yards)</div>
                              <div className="p-3 space-y-2 max-h-40 overflow-y-auto">
                                {activeAdminYards.map((y) => (
                                  <label key={y.id} className="flex items-center gap-2 text-sm cursor-pointer">
                                    <Checkbox checked={createYardIds.has(y.id)} onCheckedChange={() => toggleCreateYard(y.id)} />
                                    <span>{y.name}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {isEdit && id && (
                    <EmployeeLoginAccessSection
                      employeeId={id}
                      employeeStatus={status}
                      displayName={displayNameForAccess || employee?.empId || id}
                      workEmail={workEmail}
                    />
                  )}
                </TabsContent>
              )}
            </Tabs>
            <div className="flex flex-wrap justify-end gap-2 mt-6">
              {isEdit &&
                id &&
                canApproveRegistration &&
                (status === "Draft" || status === "Submitted" || (status === "Active" && !/^EMP-\d{3}$/i.test((empId || "").trim()))) && (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={approveMutation.isPending || pending}
                    onClick={() => approveMutation.mutate()}
                  >
                    {approveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Approve registration (assign EMP-ID)
                  </Button>
                )}
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
