import { useState, useEffect, useMemo, useCallback } from "react";
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
import {
  UserCircle,
  ArrowLeft,
  BookOpen,
  AlertCircle,
  Plus,
  Loader2,
  FileSignature,
  KeyRound,
  Paperclip,
  Trash2,
  Download,
  Eye,
} from "lucide-react";
import { EmployeeLoginAccessSection } from "@/components/hr/EmployeeLoginAccessSection";

const SERVICE_BOOK_SECTIONS = ["History", "Appendix", "AuditComments", "Verification", "CertMutable", "CertImmutable"];

const serviceBookColumns: ReportTableColumn[] = [
  { key: "section", header: "Section" },
  { key: "_status", header: "Status", sortField: "status" },
  { key: "contentText", header: "Content" },
  { key: "_approved", header: "Approved", sortField: "approvedAt" },
  { key: "_workflow", header: "Workflow" },
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

interface EmployeeDocument {
  id: string;
  employeeId: string;
  docType: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  uploadedBy?: string | null;
  createdAt: string;
}

function employeeDocumentDownloadPath(employeeId: string, docId: string): string {
  return `/api/hr/employees/${encodeURIComponent(employeeId)}/documents/${encodeURIComponent(docId)}/download`;
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
  const [docOpen, setDocOpen] = useState(false);
  const [docType, setDocType] = useState("Other");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docPreview, setDocPreview] = useState<{
    open: boolean;
    title: string;
    blobUrl: string | null;
    mime: string;
    loading: boolean;
    error: string | null;
  }>({ open: false, title: "", blobUrl: null, mime: "", loading: false, error: null });

  const uploadPreviewUrl = useMemo(() => {
    if (!docFile) return null;
    if (docFile.type.startsWith("image/") || docFile.type === "application/pdf") {
      return URL.createObjectURL(docFile);
    }
    return null;
  }, [docFile]);

  useEffect(() => {
    return () => {
      if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
    };
  }, [uploadPreviewUrl]);

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
  const { data: documents = [], isLoading: docsLoading } = useQuery<EmployeeDocument[]>({
    queryKey: ["/api/hr/employees", id, "documents"],
    enabled: !!id,
  });
  const { data: yards = [] } = useQuery<YardRef[]>({
    queryKey: ["/api/yards"],
  });
  const yardById = Object.fromEntries(yards.map((y) => [y.id, y.name]));

  /** Drop rows that do not belong to this page (avoids wrong links when React Query briefly shows cached data from another employee). */
  const docsForEmployee = useMemo(() => {
    if (!id) return [];
    return documents.filter((d) => d.employeeId === id);
  }, [documents, id]);

  const closeDocPreview = useCallback(() => {
    setDocPreview((s) => {
      if (s.blobUrl) URL.revokeObjectURL(s.blobUrl);
      return { open: false, title: "", blobUrl: null, mime: "", loading: false, error: null };
    });
  }, []);

  const loadDocPreview = useCallback(
    async (d: EmployeeDocument, employeeOwnerId: string) => {
      setDocPreview({
        open: true,
        title: d.fileName,
        blobUrl: null,
        mime: d.mimeType || "application/octet-stream",
        loading: true,
        error: null,
      });
      const url = employeeDocumentDownloadPath(employeeOwnerId, d.id);
      try {
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error ?? res.statusText);
        }
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        setDocPreview((s) => {
          if (s.blobUrl) URL.revokeObjectURL(s.blobUrl);
          return { ...s, blobUrl, loading: false };
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to load document";
        setDocPreview((s) => ({ ...s, loading: false, error: msg }));
      }
    },
    [],
  );

  const deleteDocMutation = useMutation({
    mutationFn: async (vars: { docId: string }) => {
      if (!id) throw new Error("Missing employee id");
      const res = await fetch(
        `/api/hr/employees/${encodeURIComponent(id)}/documents/${encodeURIComponent(vars.docId)}`,
        {
          method: "DELETE",
          credentials: "include",
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      // Server responds with 204 No Content — no JSON body.
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/employees", id, "documents"] });
      toast({ title: "Document deleted" });
    },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

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
        _workflow: (
          <span className="text-muted-foreground text-xs">
            {e.status === "Pending" ? "DV verify → DA approve/reject" : e.status === "Verified" ? "DA approve/reject (or DV return)" : "—"}
          </span>
        ),
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

  const documentRows = useMemo((): Record<string, unknown>[] => {
    if (!id) return [];
    return docsForEmployee.map((d) => {
      const downloadUrl = employeeDocumentDownloadPath(id, d.id);
      return {
        id: d.id,
        docType: d.docType,
        fileName: d.fileName,
        sizeBytes: d.sizeBytes,
        createdAt: d.createdAt,
        _file: (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-primary underline truncate max-w-[260px] text-left hover:opacity-90"
              onClick={() => loadDocPreview(d, id)}
            >
              {d.fileName}
            </button>
            <span className="text-xs text-muted-foreground">{Math.max(1, Math.round((d.sizeBytes ?? 0) / 1024))} KB</span>
          </div>
        ),
        _actions: (
          <div className="flex flex-wrap gap-1">
            <Button type="button" size="sm" variant="secondary" onClick={() => loadDocPreview(d, id)}>
              <Eye className="h-3.5 w-3.5 mr-1" />
              View
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={downloadUrl} target="_blank" rel="noreferrer">
                <Download className="h-3.5 w-3.5 mr-1" />
                Download
              </a>
            </Button>
            {(canUpdate || canCreate) && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => deleteDocMutation.mutate({ docId: d.id })}
                disabled={deleteDocMutation.isPending}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Delete
              </Button>
            )}
          </div>
        ),
      };
    });
  }, [docsForEmployee, id, canUpdate, canCreate, deleteDocMutation, loadDocPreview]);

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

  const uploadDocMutation = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error("Missing employee id.");
      if (!docFile) throw new Error("Choose a file to upload.");
      const fd = new FormData();
      fd.append("file", docFile);
      fd.append("docType", docType);
      const res = await fetch(`/api/hr/employees/${encodeURIComponent(id)}/documents`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/employees", id, "documents"] });
      toast({ title: "Document uploaded" });
      setDocOpen(false);
      setDocFile(null);
      setDocType("Other");
    },
    onError: (e: Error) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
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
              <TabsTrigger value="documents"><Paperclip className="h-4 w-4 mr-2" /> Documents ({documents.length})</TabsTrigger>
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
            <TabsContent value="documents" className="pt-2">
              {(canCreate || canUpdate) && (
                <div className="flex justify-end mb-2">
                  <Dialog
                    open={docOpen}
                    onOpenChange={(open) => {
                      setDocOpen(open);
                      if (!open) setDocFile(null);
                    }}
                  >
                    <DialogTrigger asChild>
                      <Button size="sm">
                        <Plus className="h-4 w-4 mr-1" /> Upload document
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Upload employee document</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label>Document type</Label>
                          <Select value={docType} onValueChange={setDocType}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {["Photo", "Aadhaar", "PAN", "AppointmentOrder", "JoiningReport", "BankProof", "Other"].map((t) => (
                                <SelectItem key={t} value={t}>
                                  {t}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>File (PDF/JPG/PNG/WebP, max 5 MB)</Label>
                          <Input
                            type="file"
                            accept="application/pdf,image/png,image/jpeg,image/webp"
                            onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
                          />
                          {docFile ? (
                            <p className="text-xs text-muted-foreground">
                              Selected: <span className="font-medium">{docFile.name}</span>
                            </p>
                          ) : null}
                          {uploadPreviewUrl && docFile?.type.startsWith("image/") ? (
                            <div className="rounded-md border bg-muted/30 p-2">
                              <p className="text-xs text-muted-foreground mb-2">Preview</p>
                              <img
                                src={uploadPreviewUrl}
                                alt=""
                                className="max-h-48 max-w-full object-contain mx-auto rounded"
                              />
                            </div>
                          ) : null}
                          {uploadPreviewUrl && docFile?.type === "application/pdf" ? (
                            <div className="rounded-md border bg-muted/30 p-2 min-h-[200px]">
                              <p className="text-xs text-muted-foreground mb-2">Preview</p>
                              <iframe title="Upload preview" src={uploadPreviewUrl} className="w-full h-56 rounded border-0 bg-background" />
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setDocOpen(false)}>
                          Cancel
                        </Button>
                        <Button type="button" disabled={uploadDocMutation.isPending} onClick={() => uploadDocMutation.mutate()}>
                          {uploadDocMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          Upload
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              )}
              {docsLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : (
                <ClientDataGrid
                  columns={[
                    { key: "docType", header: "Type" },
                    { key: "_file", header: "File", sortField: "fileName" },
                    { key: "createdAt", header: "Uploaded", sortField: "createdAt" },
                    { key: "_actions", header: "Actions" },
                  ]}
                  sourceRows={documentRows}
                  searchKeys={["docType", "fileName", "createdAt"]}
                  searchPlaceholder="Search documents…"
                  defaultSortKey="createdAt"
                  defaultSortDir="desc"
                  emptyMessage="No documents."
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

      <Dialog open={docPreview.open} onOpenChange={(open) => !open && closeDocPreview()}>
        <DialogContent className="max-w-4xl w-[min(95vw,56rem)] max-h-[90vh] flex flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
            <DialogTitle className="pr-8 truncate">{docPreview.title || "Document"}</DialogTitle>
          </DialogHeader>
          <div className="min-h-[240px] max-h-[min(72vh,720px)] border-y bg-muted/20 overflow-auto flex items-center justify-center">
            {docPreview.loading ? (
              <div className="flex flex-col items-center gap-3 py-16">
                <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Loading preview…</p>
              </div>
            ) : null}
            {docPreview.error && !docPreview.loading ? (
              <p className="text-destructive text-sm px-6 py-8 text-center">{docPreview.error}</p>
            ) : null}
            {!docPreview.loading && docPreview.blobUrl ? (
              docPreview.mime === "application/pdf" ? (
                <iframe title="Document preview" src={docPreview.blobUrl} className="w-full min-h-[65vh] border-0 bg-background" />
              ) : docPreview.mime.startsWith("image/") ? (
                <img
                  src={docPreview.blobUrl}
                  alt=""
                  className="max-w-full max-h-[min(70vh,800px)] w-auto h-auto object-contain mx-auto block p-2"
                />
              ) : (
                <p className="text-sm text-muted-foreground px-6 py-8 text-center">
                  Inline preview is not available for this file type. Use Download.
                </p>
              )
            ) : null}
          </div>
          <DialogFooter className="px-6 py-4 shrink-0 border-t flex-row justify-end gap-2 sm:justify-end">
            {docPreview.blobUrl ? (
              <Button variant="outline" asChild>
                <a href={docPreview.blobUrl} download={docPreview.title || "document"}>
                  Save copy…
                </a>
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={closeDocPreview}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
