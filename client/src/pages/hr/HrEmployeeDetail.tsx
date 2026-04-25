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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { formatApiDateOrDateTime, formatYmdToDisplay } from "@/lib/dateFormat";
import { useAuth } from "@/context/AuthContext";
import { fetchApiGet } from "@/lib/queryClient";
import { UserCircle, ArrowLeft, BookOpen, AlertCircle, Plus, Loader2, FileSignature, KeyRound } from "lucide-react";
import { EmployeeLoginAccessSection } from "@/components/hr/EmployeeLoginAccessSection";

const SERVICE_BOOK_SECTIONS = ["History", "Appendix", "AuditComments", "Verification", "CertMutable", "CertImmutable"];

const serviceBookColumns: ReportTableColumn[] = [
  { key: "section", header: "Section" },
  { key: "_status", header: "Status", sortField: "status" },
  { key: "contentText", header: "Content" },
  { key: "_approved", header: "Approved", sortField: "approvedAt" },
];

const contractColumns: ReportTableColumn[] = [
  { key: "contractType", header: "Contract type" },
  { key: "payScale", header: "Pay scale" },
  { key: "startDate", header: "Start date" },
  { key: "endDate", header: "End date" },
];

interface Employee {
  id: string;
  empId?: string | null;
  firstName: string;
  middleName?: string | null;
  surname: string;
  designation: string;
  yardId: string;
  employeeType: string;
  joiningDate: string;
  status: string;
  mobile?: string | null;
  workEmail?: string | null;
  personalEmail?: string | null;
  aadhaarToken?: string | null;
  dob?: string | null;
  pan?: string | null;
  retirementDate?: string | null;
  locationPosted?: string | null;
  payLevel?: number | null;
  bankAccountNumber?: string | null;
  ifscCode?: string | null;
  category?: string | null;
  fatherOrSpouseName?: string | null;
}
interface ServiceBookEntry {
  id: string;
  employeeId: string;
  section: string;
  content: Record<string, unknown>;
  isImmutable: boolean;
  status: string;
  approvedBy?: string | null;
  approvedAt?: string | null;
}
interface Contract {
  id: string;
  employeeId: string;
  contractType: string;
  payScale?: string | null;
  startDate: string;
  endDate?: string | null;
}
interface YardRef {
  id: string;
  name: string;
}

export default function HrEmployeeDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can, user } = useAuth();
  const canUpdate = can("M-01", "Update");
  const canCreate = can("M-01", "Create");
  const canM10Read = can("M-10", "Read");
  const canApproveRegistration =
    can("M-01", "Approve") || Boolean(user?.roles?.some((r) => r.tier === "DA" || r.tier === "ADMIN"));
  const [sbOpen, setSbOpen] = useState(false);
  const [section, setSection] = useState("History");
  const [contentText, setContentText] = useState("");
  const [status, setStatus] = useState("Draft");
  const [contractOpen, setContractOpen] = useState(false);
  const [contractType, setContractType] = useState("");
  const [payScale, setPayScale] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const { data: employee, isLoading, isError } = useQuery<Employee>({
    queryKey: ["/api/hr/employees", id],
    enabled: !!id,
  });
  const { data: serviceBook = [], isLoading: sbLoading } = useQuery<ServiceBookEntry[]>({
    queryKey: [`/api/hr/employees/${id}/service-book`],
    enabled: !!id,
  });
  const { data: contracts = [], isLoading: contractsLoading } = useQuery<Contract[]>({
    queryKey: [`/api/hr/employees/${id}/contracts`],
    enabled: !!id,
  });
  const { data: yards = [] } = useQuery<YardRef[]>({
    queryKey: ["/api/yards"],
  });
  const yardById = Object.fromEntries(yards.map((y) => [y.id, y.name]));

  const serviceBookRows = useMemo((): Record<string, unknown>[] => {
    return serviceBook.map((e) => {
      const contentText =
        typeof e.content === "object" && e.content && "text" in e.content
          ? String((e.content as { text?: string }).text)
          : "—";
      const approvedLine = e.approvedAt
        ? `${formatApiDateOrDateTime(e.approvedAt)}${e.approvedBy ? ` by ${e.approvedBy}` : ""}`
        : "—";
      return {
        id: e.id,
        section: e.section,
        status: e.status,
        contentText,
        approvedAt: e.approvedAt ?? "",
        approvedBy: e.approvedBy ?? "",
        _status: <Badge variant="outline">{e.status}</Badge>,
        _approved: <span className="text-muted-foreground text-xs">{approvedLine}</span>,
      };
    });
  }, [serviceBook]);

  const contractRows = useMemo((): Record<string, unknown>[] => {
    return contracts.map((c) => ({
      id: c.id,
      contractType: c.contractType,
      payScale: c.payScale ?? "—",
      startDate: c.startDate,
      endDate: c.endDate ?? "",
    }));
  }, [contracts]);

  const loginProfileUrl = id ? `/api/hr/employees/${id}/login-profile` : "";
  const { data: loginProfile } = useQuery<{ login: { id: string; email: string; isActive: boolean; roles?: { id: string; name: string; tier: string }[] } | null }>({
    queryKey: [loginProfileUrl],
    queryFn: () => fetchApiGet(loginProfileUrl),
    enabled: Boolean(id) && canM10Read,
  });
  const linkedLogin = loginProfile?.login ?? undefined;

  const approveRegistrationMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/hr/employees/${id}/approve-registration`, {
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
      toast({ title: "Registration approved", description: "Official EMP-ID assigned and status set to Active." });
    },
    onError: (e: Error) => toast({ title: "Approval failed", description: e.message, variant: "destructive" }),
  });

  const addSbMutation = useMutation({
    mutationFn: async (body: { section: string; content: Record<string, unknown>; status: string }) => {
      const res = await fetch(`/api/hr/employees/${id}/service-book`, {
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/hr/employees/${id}/service-book`] });
      toast({ title: "Service book entry added" });
      setSbOpen(false);
      setContentText("");
      setSection("History");
      setStatus("Draft");
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const addContractMutation = useMutation({
    mutationFn: async (body: { contractType: string; payScale?: string | null; startDate: string; endDate?: string | null }) => {
      const res = await fetch(`/api/hr/employees/${id}/contracts`, {
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/hr/employees/${id}/contracts`] });
      toast({ title: "Contract added" });
      setContractOpen(false);
      setContractType("");
      setPayScale("");
      setStartDate("");
      setEndDate("");
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const handleAddContract = (e: React.FormEvent) => {
    e.preventDefault();
    addContractMutation.mutate({
      contractType: contractType || "Regular",
      payScale: payScale || null,
      startDate: startDate || "",
      endDate: endDate || null,
    });
  };

  const handleAddSb = (e: React.FormEvent) => {
    e.preventDefault();
    addSbMutation.mutate({
      section,
      content: { text: contentText },
      status,
    });
  };

  useEffect(() => {
    if (!id) setLocation("/hr/employees");
  }, [id, setLocation]);
  if (!id) return null;
  if (isLoading || employee === undefined) {
    return (
      <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: "Employee" }]}>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-8 w-48 mb-4" />
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </AppShell>
    );
  }
  if (isError || !employee) {
    return (
      <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: "Employee" }]}>
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

  const fullName = [employee.firstName, employee.middleName, employee.surname].filter(Boolean).join(" ");
  const displayEmpId =
    employee.empId ??
    (employee.status === "Draft" || employee.status === "Submitted" ? null : employee.id);
  const hasOfficialEmpId = /^EMP-\d{3}$/i.test((employee.empId ?? "").trim());
  const showApproveRegistration =
    Boolean(id) &&
    canApproveRegistration &&
    (employee.status === "Draft" ||
      employee.status === "Submitted" ||
      (employee.status === "Active" && !hasOfficialEmpId));

  return (
    <AppShell
      breadcrumbs={[
        { label: "HR", href: "/hr/employees" },
        { label: displayEmpId ? `${displayEmpId} — ${fullName}` : fullName },
      ]}
    >
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <UserCircle className="h-5 w-5" />
            {displayEmpId ? `${displayEmpId} — ${fullName}` : fullName}
          </CardTitle>
          <div className="flex flex-wrap gap-2 justify-end">
            {showApproveRegistration && (
              <Button
                variant="secondary"
                size="sm"
                disabled={approveRegistrationMutation.isPending}
                onClick={() => approveRegistrationMutation.mutate()}
              >
                {approveRegistrationMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Approve registration (EMP-ID)
              </Button>
            )}
            {canUpdate && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/hr/employees/${id}/edit`}>Edit</Link>
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setLocation("/hr/employees")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Back
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {(employee.status === "Draft" || employee.status === "Submitted") && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-100">
              Registration is <span className="font-medium">{employee.status}</span>. Official EMP-ID is assigned when a Data Approver approves (BR-EMP-06).
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div><span className="text-muted-foreground">Designation</span><br />{employee.designation}</div>
            <div><span className="text-muted-foreground">Yard</span><br />{yardById[employee.yardId] ?? employee.yardId}</div>
            <div>
              <span className="text-muted-foreground">Location posted</span>
              <br />
              {employee.locationPosted ?? "—"}
            </div>
            <div>
              <span className="text-muted-foreground">Pay level</span>
              <br />
              {employee.payLevel != null && !Number.isNaN(Number(employee.payLevel)) ? String(employee.payLevel) : "—"}
            </div>
            <div>
              <span className="text-muted-foreground">Category</span>
              <br />
              {employee.category ?? "—"}
            </div>
            <div>
              <span className="text-muted-foreground">Father / spouse</span>
              <br />
              {employee.fatherOrSpouseName ?? "—"}
            </div>
            <div><span className="text-muted-foreground">Type</span><br />{employee.employeeType}</div>
            <div><span className="text-muted-foreground">Status</span><br /><Badge variant="secondary">{employee.status}</Badge></div>
            <div><span className="text-muted-foreground">Joining date</span><br />{formatYmdToDisplay(employee.joiningDate)}</div>
            <div><span className="text-muted-foreground">DOB</span><br />{formatYmdToDisplay(employee.dob ?? "")}</div>
            <div><span className="text-muted-foreground">Mobile</span><br />{employee.mobile ?? "—"}</div>
            <div><span className="text-muted-foreground">Work email</span><br />{employee.workEmail ?? "—"}</div>
            <div><span className="text-muted-foreground">Personal email</span><br />{employee.personalEmail ?? "—"}</div>
            <div><span className="text-muted-foreground">PAN</span><br />{employee.pan ?? "—"}</div>
            <div><span className="text-muted-foreground">Aadhaar (masked)</span><br />{employee.aadhaarToken ?? "—"}</div>
            <div>
              <span className="text-muted-foreground">Bank account no.</span>
              <br />
              <span className="font-mono tabular-nums">{employee.bankAccountNumber ?? "—"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">IFSC</span>
              <br />
              <span className="font-mono">{employee.ifscCode ?? "—"}</span>
            </div>
            {employee.retirementDate && (
              <div>
                <span className="text-muted-foreground">Retirement</span>
                <br />
                {formatYmdToDisplay(employee.retirementDate)}
              </div>
            )}
          </div>

          {canM10Read && (
            <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
              <div className="font-medium text-foreground mb-1 flex items-center gap-2">
                <KeyRound className="h-4 w-4" />
                App login &amp; roles (IOMS M-10)
              </div>
              {linkedLogin ? (
                <div className="space-y-2 text-muted-foreground">
                  <div>
                    <span className="text-muted-foreground">Sign-in</span>
                    <span className="text-foreground ml-2 font-mono text-xs">{linkedLogin.email}</span>
                    <Badge variant={linkedLogin.isActive ? "default" : "secondary"} className="ml-2">
                      {linkedLogin.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground shrink-0">Roles</span>
                    {(linkedLogin.roles?.length ?? 0) > 0 ? (
                      linkedLogin.roles!.map((r) => (
                        <Badge key={r.id} variant="outline" className="font-normal text-xs">
                          {r.name}
                          <span className="text-muted-foreground ml-1">({r.tier})</span>
                        </Badge>
                      ))
                    ) : (
                      <span className="text-amber-700 dark:text-amber-400">No roles — user cannot use modules until you assign at least one.</span>
                    )}
                  </div>
                  <p className="text-xs">To change password, yards, or role checkboxes, open the <span className="font-medium text-foreground">Login &amp; roles</span> tab below.</p>
                </div>
              ) : (
                <p className="text-muted-foreground">
                  No application login linked to this employee yet. Open the <span className="font-medium text-foreground">Login &amp; roles</span> tab to enable sign-in and map roles and locations.
                </p>
              )}
            </div>
          )}

          <Tabs defaultValue="servicebook">
            <TabsList className="flex-wrap h-auto gap-1">
              <TabsTrigger value="servicebook"><BookOpen className="h-4 w-4 mr-2" /> Service book ({serviceBook.length})</TabsTrigger>
              <TabsTrigger value="contracts"><FileSignature className="h-4 w-4 mr-2" /> Contracts ({contracts.length})</TabsTrigger>
              <TabsTrigger value="access"><KeyRound className="h-4 w-4 mr-2" /> Login &amp; roles</TabsTrigger>
            </TabsList>
            <TabsContent value="servicebook" className="pt-2">
              {canCreate && (
              <div className="flex justify-end mb-2">
                <Dialog open={sbOpen} onOpenChange={setSbOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add entry</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Add service book entry</DialogTitle></DialogHeader>
                    <form onSubmit={handleAddSb} className="space-y-4">
                      <div><Label>Section</Label>
                        <Select value={section} onValueChange={setSection}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {SERVICE_BOOK_SECTIONS.map((s) => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div><Label>Content (text)</Label><Input value={contentText} onChange={(e) => setContentText(e.target.value)} placeholder="Summary or note" /></div>
                      <div><Label>Status</Label><Input value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Draft" /></div>
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setSbOpen(false)}>Cancel</Button>
                        <Button type="submit" disabled={addSbMutation.isPending}>
                          {addSbMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Add
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
              )}
              {sbLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <ClientDataGrid
                  columns={serviceBookColumns}
                  sourceRows={serviceBookRows}
                  searchKeys={["section", "status", "contentText", "approvedAt", "approvedBy"]}
                  searchPlaceholder="Search service book…"
                  defaultSortKey="section"
                  defaultSortDir="asc"
                  emptyMessage="No service book entries."
                />
              )}
            </TabsContent>
            <TabsContent value="contracts" className="pt-2">
              {canCreate && (
              <div className="flex justify-end mb-2">
                <Dialog open={contractOpen} onOpenChange={setContractOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add contract</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Add contract</DialogTitle></DialogHeader>
                    <form onSubmit={handleAddContract} className="space-y-4">
                      <div><Label>Contract type *</Label><Input value={contractType} onChange={(e) => setContractType(e.target.value)} placeholder="e.g. Regular, Contract" required /></div>
                      <div><Label>Pay scale</Label><Input value={payScale} onChange={(e) => setPayScale(e.target.value)} placeholder="Optional" /></div>
                      <div><Label>Start date *</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required /></div>
                      <div><Label>End date</Label><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setContractOpen(false)}>Cancel</Button>
                        <Button type="submit" disabled={addContractMutation.isPending}>
                          {addContractMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Add
                        </Button>
                      </DialogFooter>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
              )}
              {contractsLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <ClientDataGrid
                  columns={contractColumns}
                  sourceRows={contractRows}
                  searchKeys={["contractType", "payScale", "startDate", "endDate"]}
                  searchPlaceholder="Search contracts…"
                  defaultSortKey="startDate"
                  defaultSortDir="desc"
                  emptyMessage="No contracts."
                />
              )}
            </TabsContent>
            <TabsContent value="access" className="pt-2">
              <EmployeeLoginAccessSection
                employeeId={employee.id}
                employeeStatus={employee.status}
                displayName={fullName}
                workEmail={employee.workEmail}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </AppShell>
  );
}
