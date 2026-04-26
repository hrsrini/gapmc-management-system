import { useState, useEffect, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import {
  isValidEmailFormat,
  isStrictAadhaar12Digits,
  isValidIfscFormat,
  parseIndianMobile10Digits,
  sanitizeMobile10Input,
} from "@shared/india-validation";
import { getPasswordPolicyBrUsr10FirstViolation, passwordPolicyBrUsr10Hint } from "@shared/password-policy-br-usr-10";

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
  gender?: string | null;
  maritalStatus?: string | null;
  bloodGroup?: string | null;
  permanentAddress?: string | null;
  correspondenceAddress?: string | null;
  emergencyContactName?: string | null;
  emergencyContactMobile?: string | null;
  reportingOfficerEmployeeId?: string | null;
  locationPosted?: string | null;
  payLevel?: number | null;
  bankAccountNumber?: string | null;
  ifscCode?: string | null;
  category?: string | null;
  fatherOrSpouseName?: string | null;
  status: string;
  userId?: string | null;
}

interface Role {
  id: string;
  name: string;
  tier: string;
}

const EMPLOYEE_TYPES = ["Regular", "Contract", "Daily Wage", "Temporary"];
const STATUS_OPTIONS = ["Draft", "Submitted", "Recommended", "Active", "Inactive", "Suspended", "Retired", "Resigned"];
const GENDER_OPTIONS = ["", "Male", "Female", "Other", "Prefer not to say"];
const MARITAL_OPTIONS = ["", "Single", "Married", "Widowed", "Divorced"];
/** SRS §4.1.1 — reservation / employee category (value stored as text). */
const EMPLOYEE_CATEGORIES = ["General", "SC", "ST", "OBC", "EWS", "PwBD", "Ex-servicemen"];
const BLOOD_GROUP_OPTIONS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
const PAY_LEVELS = Array.from({ length: 18 }, (_, i) => i + 1);

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
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [designation, setDesignation] = useState("");
  const [yardId, setYardId] = useState("");
  const [employeeType, setEmployeeType] = useState("Regular");
  const [empId, setEmpId] = useState("");

  /** Create: optional 12-digit Aadhaar (raw, never persisted; server stores masked + fingerprint). */
  const [aadhaarInput, setAadhaarInput] = useState("");
  const [pan, setPan] = useState("");
  const [dob, setDob] = useState("");
  const [mobile, setMobile] = useState("");
  const [workEmail, setWorkEmail] = useState("");
  const [personalEmail, setPersonalEmail] = useState("");

  const [joiningDate, setJoiningDate] = useState("");
  const [retirementDate, setRetirementDate] = useState("");
  const [status, setStatus] = useState("Draft");
  const [gender, setGender] = useState("");
  const [maritalStatus, setMaritalStatus] = useState("");
  const [bloodGroup, setBloodGroup] = useState("");
  const [permanentAddress, setPermanentAddress] = useState("");
  const [correspondenceAddress, setCorrespondenceAddress] = useState("");
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactMobile, setEmergencyContactMobile] = useState("");
  const [reportingOfficerEmployeeId, setReportingOfficerEmployeeId] = useState("");
  const [locationPosted, setLocationPosted] = useState("");
  const [payLevel, setPayLevel] = useState<string>("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [ifscCode, setIfscCode] = useState("");
  const [category, setCategory] = useState("");
  const [fatherOrSpouseName, setFatherOrSpouseName] = useState("");

  const [enableLoginOnCreate, setEnableLoginOnCreate] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginConfirm, setLoginConfirm] = useState("");
  const [createRoleIds, setCreateRoleIds] = useState<Set<string>>(new Set());
  const [createYardIds, setCreateYardIds] = useState<Set<string>>(new Set());

  const { data: yards = [] } = useQuery<Yard[]>({ queryKey: ["/api/yards"] });
  const { data: allEmployees = [] } = useQuery<Employee[]>({ queryKey: ["/api/hr/employees"] });
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
      setAadhaarInput("");
      setPan(employee.pan ?? "");
      setDob(employee.dob ?? "");
      setMobile(sanitizeMobile10Input(employee.mobile ?? ""));
      setWorkEmail(employee.workEmail ?? "");
      setPersonalEmail(employee.personalEmail ?? "");
      setJoiningDate(employee.joiningDate ?? "");
      setRetirementDate(employee.retirementDate ?? "");
      setStatus(employee.status ?? "Active");
      setGender(employee.gender ?? "");
      setMaritalStatus(employee.maritalStatus ?? "");
      setBloodGroup(employee.bloodGroup ?? "");
      setPermanentAddress(employee.permanentAddress ?? "");
      setCorrespondenceAddress(employee.correspondenceAddress ?? "");
      setEmergencyContactName(employee.emergencyContactName ?? "");
      setEmergencyContactMobile(sanitizeMobile10Input(employee.emergencyContactMobile ?? ""));
      setReportingOfficerEmployeeId(employee.reportingOfficerEmployeeId ?? "");
      setLocationPosted(employee.locationPosted ?? "");
      setPayLevel(employee.payLevel != null && !Number.isNaN(Number(employee.payLevel)) ? String(employee.payLevel) : "");
      setBankAccountNumber(employee.bankAccountNumber ?? "");
      setIfscCode(employee.ifscCode ?? "");
      setCategory(employee.category ?? "");
      setFatherOrSpouseName(employee.fatherOrSpouseName ?? "");
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

  const recommendMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/hr/employees/${id}/recommend-registration`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return (await res.json()) as Employee;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/employees", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/hr/employees"] });
      toast({ title: "Recommended", description: "Registration forwarded to DA for approval." });
    },
    onError: (e: Error) => toast({ title: "Recommend failed", description: e.message, variant: "destructive" }),
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
    // Photo validation (SRS): <= 500 KB, >= 200x200 px (only when uploading a file).
    if (photoFile) {
      if (photoFile.size > 500 * 1024) {
        toast({ title: "Photo too large", description: "Photo must be 500 KB or smaller.", variant: "destructive" });
        return;
      }
      const url = URL.createObjectURL(photoFile);
      try {
        let dims: { w: number; h: number } | null = null;
        try {
          dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve({ w: img.width, h: img.height });
            img.onerror = () => reject(new Error("PHOTO_LOAD_FAILED"));
            img.src = url;
          });
        } catch {
          toast({
            title: "Invalid photo",
            description: "Could not read this image. Please upload a valid PNG/JPG/WebP file.",
            variant: "destructive",
          });
          return;
        }
        if (dims.w < 200 || dims.h < 200) {
          toast({ title: "Photo too small", description: "Photo must be at least 200×200 pixels.", variant: "destructive" });
          return;
        }
      } finally {
        URL.revokeObjectURL(url);
      }
    }
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
    const aadhaarTrim = aadhaarInput.trim();
    if (aadhaarTrim && !isStrictAadhaar12Digits(aadhaarTrim)) {
      toast({
        title: "Invalid Aadhaar",
        description: "Enter exactly 12 digits with no spaces, or leave blank to keep the value on file.",
        variant: "destructive",
      });
      return;
    }

    const emMobile =
      emergencyContactMobile.trim() === ""
        ? null
        : (() => {
            const m = parseIndianMobile10Digits(emergencyContactMobile);
            return m;
          })();
    if (emergencyContactMobile.trim() && !emMobile) {
      toast({ title: "Invalid emergency mobile", description: "Use a valid 10-digit Indian mobile or leave blank.", variant: "destructive" });
      return;
    }

    const bankDigits = bankAccountNumber.replace(/\D/g, "");
    if (bankDigits.length > 0 && (bankDigits.length < 9 || bankDigits.length > 18)) {
      toast({
        title: "Invalid bank account number",
        description: "Use 9 to 18 digits, or leave blank.",
        variant: "destructive",
      });
      return;
    }
    const ifscTrim = ifscCode.trim();
    if (ifscTrim && !isValidIfscFormat(ifscTrim)) {
      toast({ title: "Invalid IFSC", description: "Use 11 characters: 4 letters, 0, then 6 letters or digits (e.g. SBIN0001234).", variant: "destructive" });
      return;
    }

    const payload: Record<string, unknown> = {
      firstName,
      middleName: middleName || null,
      surname,
      photoUrl: photoUrl || null,
      designation,
      yardId,
      employeeType,
      pan: pan || null,
      dob: dob || null,
      mobile: mobileNorm,
      workEmail: we,
      personalEmail: pe,
      joiningDate,
      retirementDate: retirementDate || null,
      status,
      gender: gender || null,
      maritalStatus: maritalStatus || null,
      bloodGroup: bloodGroup || null,
      permanentAddress: permanentAddress.trim() || null,
      correspondenceAddress: correspondenceAddress.trim() || null,
      emergencyContactName: emergencyContactName.trim() || null,
      emergencyContactMobile: emMobile,
      reportingOfficerEmployeeId: reportingOfficerEmployeeId.trim() || null,
      locationPosted: locationPosted.trim() || null,
      payLevel: payLevel ? parseInt(payLevel, 10) : null,
      bankAccountNumber: bankDigits || null,
      ifscCode: ifscTrim ? ifscTrim.toUpperCase().replace(/\s/g, "") : null,
      category: category.trim() || null,
      fatherOrSpouseName: fatherOrSpouseName.trim() || null,
    };
    if (!isEdit) {
      // Send raw Aadhaar digits for server-side masking + fingerprint; raw is never stored.
      payload.aadhaarRaw = aadhaarTrim || null;
    } else if (aadhaarTrim) {
      payload.aadhaarRaw = aadhaarTrim;
    }

    if (isEdit) {
      updateMutation.mutate(payload);
      return;
    }

    setSubmitting(true);
    try {
      const emp = await createMutation.mutateAsync(payload);
      queryClient.invalidateQueries({ queryKey: ["/api/hr/employees"] });

      // If a photo file was selected, store it as an employee document (Photo) and set employee.photoUrl to the download URL.
      if (photoFile) {
        const fd = new FormData();
        fd.append("file", photoFile);
        fd.append("docType", "Photo");
        const up = await fetch(`/api/hr/employees/${emp.id}/documents`, {
          method: "POST",
          credentials: "include",
          body: fd,
        });
        if (!up.ok) {
          const err = await up.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error ?? up.statusText);
        }
        const uploaded = (await up.json()) as { id: string };
        const photoDownloadUrl = `${window.location.origin}/api/hr/employees/${emp.id}/documents/${uploaded.id}/download`;
        await updateMutation.mutateAsync({ photoUrl: photoDownloadUrl });
      }

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
        const lpErr = getPasswordPolicyBrUsr10FirstViolation(loginPassword);
        if (lpErr || loginPassword !== loginConfirm) {
          toast({
            title: "Employee created",
            description: lpErr
              ? `${lpErr} Finish login on the employee page.`
              : `Passwords must match. ${passwordPolicyBrUsr10Hint()} Finish login on the employee page.`,
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
                  <div className="space-y-2">
                    <Label>Photo</Label>
                    <Input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Optional. Must be ≤ 500 KB and ≥ 200×200 px. Uploaded photos are stored under employee documents.
                    </p>
                    <div>
                      <Label className="text-xs text-muted-foreground">Photo URL (optional)</Label>
                      <Input value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://..." />
                    </div>
                  </div>
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
                  <div className="md:col-span-2">
                    <Label>Location posted</Label>
                    <Input
                      value={locationPosted}
                      onChange={(e) => setLocationPosted(e.target.value)}
                      placeholder="Official posting / work location (SRS §4.1.1)"
                      maxLength={200}
                    />
                  </div>
                  <div>
                    <Label>Pay level</Label>
                    <Select
                      value={payLevel || "__none__"}
                      onValueChange={(v) => setPayLevel(v === "__none__" ? "" : v)}
                    >
                      <SelectTrigger><SelectValue placeholder="1–18" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Not specified</SelectItem>
                        {PAY_LEVELS.map((n) => (
                          <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">§4.1.1: level 1–18 (optional).</p>
                  </div>
                  <div>
                    <Label>Category</Label>
                    <Select
                      value={category || "__none__"}
                      onValueChange={(v) => setCategory(v === "__none__" ? "" : v)}
                    >
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        {EMPLOYEE_CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                        <SelectItem value="__none__">Not specified</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">Reservation / employee category (§4.1.1).</p>
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
                  <div className="md:col-span-2">
                    <Label>Father / spouse name</Label>
                    <Input
                      value={fatherOrSpouseName}
                      onChange={(e) => setFatherOrSpouseName(e.target.value)}
                      placeholder="As per service record (§4.1.1)"
                      maxLength={150}
                    />
                  </div>
                  <div className="md:col-span-2 space-y-2">
                    <Label htmlFor="hr-emp-aadhaar" className="leading-snug">
                      {isEdit && employee?.aadhaarToken ? (
                        <>
                          <span className="block">Aadhaar number</span>
                          <span className="mt-1.5 block rounded-md border bg-muted/40 px-2.5 py-2 font-mono text-sm font-normal tabular-nums tracking-normal text-foreground">
                            {employee.aadhaarToken}
                          </span>
                          <span className="mt-1.5 block text-xs font-normal text-muted-foreground">
                            Masked value on file. Leave the field below empty to keep it; enter 12 digits only to replace.
                          </span>
                        </>
                      ) : (
                        "Aadhaar number"
                      )}
                    </Label>
                    <Input
                      id="hr-emp-aadhaar"
                      value={aadhaarInput}
                      onChange={(e) => setAadhaarInput(e.target.value.replace(/\D/g, "").slice(0, 12))}
                      placeholder={
                        isEdit
                          ? employee?.aadhaarToken
                            ? "Optional — 12 digits to replace"
                            : "Optional — 12 digits"
                          : "Optional — 12 digits"
                      }
                      inputMode="numeric"
                      maxLength={12}
                      autoComplete="off"
                    />
                  </div>
                  <div><Label>PAN</Label><Input value={pan} onChange={(e) => setPan(e.target.value)} /></div>
                  <div><Label>Date of birth</Label><Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} /></div>
                  <div>
                    <Label>Mobile</Label>
                    <Input
                      value={mobile}
                      onChange={(e) => setMobile(sanitizeMobile10Input(e.target.value))}
                      inputMode="numeric"
                      maxLength={10}
                      placeholder="10-digit mobile"
                      autoComplete="tel-national"
                    />
                  </div>
                  <div><Label>Personal email</Label><Input type="email" value={personalEmail} onChange={(e) => setPersonalEmail(e.target.value)} placeholder="Must be unique among active / pending employees" /></div>
                  <div><Label>Work email</Label><Input type="email" value={workEmail} onChange={(e) => setWorkEmail(e.target.value)} /></div>
                  <div>
                    <Label>Gender</Label>
                    <Select value={gender || "__none__"} onValueChange={(v) => setGender(v === "__none__" ? "" : v)}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        {GENDER_OPTIONS.filter((g) => g !== "").map((g) => (
                          <SelectItem key={g} value={g}>{g}</SelectItem>
                        ))}
                        <SelectItem value="__none__">Not specified</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Marital status</Label>
                    <Select value={maritalStatus || "__none__"} onValueChange={(v) => setMaritalStatus(v === "__none__" ? "" : v)}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        {MARITAL_OPTIONS.filter((g) => g !== "").map((g) => (
                          <SelectItem key={g} value={g}>{g}</SelectItem>
                        ))}
                        <SelectItem value="__none__">Not specified</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Blood group</Label>
                    <Select value={bloodGroup || "__none__"} onValueChange={(v) => setBloodGroup(v === "__none__" ? "" : v)}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        {BLOOD_GROUP_OPTIONS.map((b) => (
                          <SelectItem key={b} value={b}>{b}</SelectItem>
                        ))}
                        <SelectItem value="__none__">Not specified</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-2">
                    <Label>Permanent address</Label>
                    <Textarea value={permanentAddress} onChange={(e) => setPermanentAddress(e.target.value)} rows={2} />
                  </div>
                  <div className="md:col-span-2">
                    <Label>Correspondence address</Label>
                    <Textarea value={correspondenceAddress} onChange={(e) => setCorrespondenceAddress(e.target.value)} rows={2} />
                  </div>
                  <div><Label>Emergency contact name</Label><Input value={emergencyContactName} onChange={(e) => setEmergencyContactName(e.target.value)} /></div>
                  <div>
                    <Label>Emergency contact mobile</Label>
                    <Input
                      value={emergencyContactMobile}
                      onChange={(e) => setEmergencyContactMobile(sanitizeMobile10Input(e.target.value))}
                      inputMode="numeric"
                      maxLength={10}
                      placeholder="10-digit mobile"
                    />
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="hr" className="space-y-4 pt-4">
                <div>
                  <p className="text-sm font-medium text-foreground mb-2">Bank &amp; financial (§4.1.1)</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label>Bank account no.</Label>
                      <Input
                        value={bankAccountNumber}
                        onChange={(e) => setBankAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 18))}
                        inputMode="numeric"
                        placeholder="9–18 digits"
                        autoComplete="off"
                      />
                    </div>
                    <div>
                      <Label>IFSC code</Label>
                      <Input
                        value={ifscCode}
                        onChange={(e) => setIfscCode(e.target.value.toUpperCase().replace(/\s/g, "").slice(0, 11))}
                        placeholder="e.g. SBIN0001234"
                        className="font-mono"
                        maxLength={11}
                        autoComplete="off"
                      />
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <Label>Reporting officer</Label>
                    <Select
                      value={reportingOfficerEmployeeId || "__none__"}
                      onValueChange={(v) => setReportingOfficerEmployeeId(v === "__none__" ? "" : v)}
                    >
                      <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {allEmployees
                          .filter((e) => !isEdit || e.id !== id)
                          .map((e) => (
                            <SelectItem key={e.id} value={e.id}>
                              {(e.empId ?? e.id) + " — " + e.firstName + " " + e.surname}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
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
                              <Input type="password" autoComplete="new-password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} minLength={12} />
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
              {isEdit && id && (status === "Submitted") && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={recommendMutation.isPending || pending}
                  onClick={() => recommendMutation.mutate()}
                >
                  {recommendMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Recommend to DA
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
