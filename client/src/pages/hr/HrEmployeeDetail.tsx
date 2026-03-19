import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { useAuth } from "@/context/AuthContext";
import { UserCircle, ArrowLeft, BookOpen, AlertCircle, Plus, Loader2, FileSignature } from "lucide-react";

const SERVICE_BOOK_SECTIONS = ["History", "Appendix", "AuditComments", "Verification", "CertMutable", "CertImmutable"];

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
  dob?: string | null;
  pan?: string | null;
  retirementDate?: string | null;
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
  const { can } = useAuth();
  const canUpdate = can("M-01", "Update");
  const canCreate = can("M-01", "Create");
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

  return (
    <AppShell breadcrumbs={[{ label: "HR", href: "/hr/employees" }, { label: employee.empId ?? fullName }]}>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <UserCircle className="h-5 w-5" />
            {employee.empId ?? employee.id} — {fullName}
          </CardTitle>
          <div className="flex gap-2">
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div><span className="text-muted-foreground">Designation</span><br />{employee.designation}</div>
            <div><span className="text-muted-foreground">Yard</span><br />{yardById[employee.yardId] ?? employee.yardId}</div>
            <div><span className="text-muted-foreground">Type</span><br />{employee.employeeType}</div>
            <div><span className="text-muted-foreground">Status</span><br /><Badge variant="secondary">{employee.status}</Badge></div>
            <div><span className="text-muted-foreground">Joining date</span><br />{employee.joiningDate}</div>
            <div><span className="text-muted-foreground">DOB</span><br />{employee.dob ?? "—"}</div>
            <div><span className="text-muted-foreground">Mobile</span><br />{employee.mobile ?? "—"}</div>
            <div><span className="text-muted-foreground">Email</span><br />{employee.workEmail ?? "—"}</div>
            {employee.retirementDate && <div><span className="text-muted-foreground">Retirement</span><br />{employee.retirementDate}</div>}
          </div>

          <Tabs defaultValue="servicebook">
            <TabsList>
              <TabsTrigger value="servicebook"><BookOpen className="h-4 w-4 mr-2" /> Service book ({serviceBook.length})</TabsTrigger>
              <TabsTrigger value="contracts"><FileSignature className="h-4 w-4 mr-2" /> Contracts ({contracts.length})</TabsTrigger>
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
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Section</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Content</TableHead>
                      <TableHead>Approved</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {serviceBook.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-muted-foreground text-center py-6">No service book entries.</TableCell>
                      </TableRow>
                    ) : (
                      serviceBook.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell>{e.section}</TableCell>
                          <TableCell><Badge variant="outline">{e.status}</Badge></TableCell>
                          <TableCell className="max-w-[200px] truncate">{typeof e.content === "object" && e.content && "text" in e.content ? String((e.content as { text?: string }).text) : "—"}</TableCell>
                          <TableCell className="text-muted-foreground text-xs">{e.approvedAt ?? "—"} {e.approvedBy ? `by ${e.approvedBy}` : ""}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
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
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contract type</TableHead>
                      <TableHead>Pay scale</TableHead>
                      <TableHead>Start date</TableHead>
                      <TableHead>End date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contracts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-muted-foreground text-center py-6">No contracts.</TableCell>
                      </TableRow>
                    ) : (
                      contracts.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell>{c.contractType}</TableCell>
                          <TableCell>{c.payScale ?? "—"}</TableCell>
                          <TableCell>{c.startDate}</TableCell>
                          <TableCell>{c.endDate ?? "—"}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </AppShell>
  );
}
