import { useMemo, useState, useEffect } from "react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { localCalendarYmd } from "@shared/premises-allocation";
import { Mail, Loader2, AlertCircle } from "lucide-react";

interface Yard {
  id: string;
  code?: string | null;
  name?: string | null;
  type?: string | null;
  address?: string | null;
  /** Sender designation from Location Master (autofill From Party). */
  partyName?: string | null;
}

interface EmployeeRef {
  id: string;
  empId?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  surname?: string | null;
  yardId?: string | null;
  section?: string | null;
  status?: string | null;
  reportingOfficerEmployeeId?: string | null;
}

interface Inward {
  id: string;
  diaryNo?: string | null;
  receivedDate: string;
  fromParty: string;
  subject: string;
  modeOfReceipt: string;
  status: string;
  yardId?: string | null;
  fromAddress?: string | null;
  receivedBy?: string | null;
  assignedTo?: string | null;
  deadline?: string | null;
  fileRef?: string | null;
}

const MODES = ["Hand", "Post", "Courier", "Email", "Fax"];
const STATUS_OPTIONS = ["Pending", "InProgress", "Closed"];
const HO_SECTIONS = ["Admin Section", "Inspection Section", "Accounts Section"] as const;

function isHeadOfficeYard(y: { type?: string | null; name?: string | null; code?: string | null } | undefined): boolean {
  if (!y) return false;
  if (String(y.type ?? "").trim().toUpperCase() === "HO") return true;
  const name = String(y.name ?? "").toLowerCase();
  const code = String(y.code ?? "").toLowerCase();
  return name.includes("head office") || code === "ho" || code.startsWith("ho-");
}

function isYardOrCheckPost(y: { type?: string | null } | undefined): boolean {
  const t = String(y?.type ?? "").trim().toLowerCase();
  return t === "yard" || t === "checkpost" || t === "check_post" || t === "check-post";
}

/** Locations that can be selected as Received From (HO, Yard, Checkpost). */
function isReceivedFromLocation(y: { type?: string | null; name?: string | null; code?: string | null } | undefined): boolean {
  return isYardOrCheckPost(y) || isHeadOfficeYard(y);
}

function employeeFullName(e: EmployeeRef): string {
  return [e.firstName, e.middleName, e.surname].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function isActiveEmployee(e: EmployeeRef): boolean {
  const s = String(e.status ?? "Active").trim();
  return s === "Active" || s === "";
}

/** Prefer the person most often set as reporting officer among the group. */
function pickDefaultReportingOfficerId(emps: EmployeeRef[]): string | null {
  const counts = new Map<string, number>();
  for (const e of emps) {
    const ro = String(e.reportingOfficerEmployeeId ?? "").trim();
    if (!ro) continue;
    counts.set(ro, (counts.get(ro) ?? 0) + 1);
  }
  let bestId: string | null = null;
  let bestCount = 0;
  for (const [id, n] of counts) {
    if (n > bestCount) {
      bestCount = n;
      bestId = id;
    }
  }
  return bestId;
}

export default function DakInwardForm() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isEdit = !!id;

  const [diaryNo, setDiaryNo] = useState("");
  const [receivedDate, setReceivedDate] = useState(() => localCalendarYmd());
  const [fromYardOrCheckpost, setFromYardOrCheckpost] = useState<"yes" | "no">("no");
  const [fromLocationId, setFromLocationId] = useState("");
  const [fromParty, setFromParty] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [subject, setSubject] = useState("");
  const [modeOfReceipt, setModeOfReceipt] = useState("Hand");
  const [status, setStatus] = useState("Pending");
  const [receivedBy, setReceivedBy] = useState("");
  const [receivedLocationLabel, setReceivedLocationLabel] = useState("");
  const [receivedYardId, setReceivedYardId] = useState<string | null>(null);
  const [sectionName, setSectionName] = useState("");
  const [assignedEmployeeId, setAssignedEmployeeId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [deadline, setDeadline] = useState("");
  const [fileRef, setFileRef] = useState("");
  const [partyLockedFromLocation, setPartyLockedFromLocation] = useState(false);

  /** All active locations for Received From (not limited by logged-in employee's posting). */
  const { data: yards = [] } = useQuery<Yard[]>({
    queryKey: ["/api/yards/for-correspondence"],
    queryFn: async () => {
      const res = await fetch("/api/yards/for-correspondence", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load locations");
      return res.json();
    },
  });
  const { data: inward, isError: inwardError } = useQuery<Inward>({
    queryKey: ["/api/ioms/dak/inward", id],
    enabled: isEdit,
  });

  const { data: selfEmployee } = useQuery<EmployeeRef>({
    queryKey: ["/api/hr/employees", user?.employeeId],
    queryFn: async () => {
      const res = await fetch(`/api/hr/employees/${encodeURIComponent(user!.employeeId)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load employee");
      return res.json();
    },
    enabled: !!user?.employeeId,
  });

  const yardById = useMemo(() => Object.fromEntries(yards.map((y) => [y.id, y])), [yards]);

  // All active locations — not limited by employee posting or location type.
  const fromLocationOptions = useMemo(
    () => yards.slice().sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [yards],
  );

  const userIsHo = useMemo(() => {
    if (selfEmployee?.yardId && isHeadOfficeYard(yardById[selfEmployee.yardId])) return true;
    return (user?.yardIds ?? []).some((yid) => isHeadOfficeYard(yardById[yid]));
  }, [selfEmployee?.yardId, user?.yardIds, yardById]);

  const markedToYardId = useMemo(() => {
    if (userIsHo) {
      const ho = yards.find((y) => isHeadOfficeYard(y));
      return ho?.id ?? selfEmployee?.yardId ?? null;
    }
    return selfEmployee?.yardId ?? receivedYardId ?? null;
  }, [userIsHo, yards, selfEmployee?.yardId, receivedYardId]);

  const employeesUrl = markedToYardId
    ? `/api/hr/employees?yardId=${encodeURIComponent(markedToYardId)}`
    : "/api/hr/employees";

  const { data: locationEmployees = [] } = useQuery<EmployeeRef[]>({
    queryKey: [employeesUrl],
    queryFn: async () => {
      const res = await fetch(employeesUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load employees");
      return res.json();
    },
    enabled: !!markedToYardId || !userIsHo,
  });

  const markedToEmployees = useMemo(() => {
    let list = (locationEmployees ?? []).filter(isActiveEmployee);
    if (userIsHo && sectionName.trim()) {
      list = list.filter((e) => String(e.section ?? "").trim() === sectionName.trim());
    }
    return list.slice().sort((a, b) => employeeFullName(a).localeCompare(employeeFullName(b)));
  }, [locationEmployees, userIsHo, sectionName]);

  const defaultRoId = useMemo(() => pickDefaultReportingOfficerId(markedToEmployees), [markedToEmployees]);

  const { data: defaultRoEmployee } = useQuery<EmployeeRef>({
    queryKey: ["/api/hr/employees", defaultRoId, "ro"],
    queryFn: async () => {
      const res = await fetch(`/api/hr/employees/${encodeURIComponent(defaultRoId!)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load reporting officer");
      return res.json();
    },
    enabled: !!defaultRoId && !markedToEmployees.some((e) => e.id === defaultRoId),
  });

  const assignedOptions = useMemo(() => {
    const byId = new Map(markedToEmployees.map((e) => [e.id, e]));
    if (defaultRoEmployee && !byId.has(defaultRoEmployee.id)) {
      byId.set(defaultRoEmployee.id, defaultRoEmployee);
    }
    return Array.from(byId.values()).sort((a, b) => employeeFullName(a).localeCompare(employeeFullName(b)));
  }, [markedToEmployees, defaultRoEmployee]);

  // Auto-fill received by / location from logged-in user
  useEffect(() => {
    if (isEdit) return;
    const name = user?.name?.trim() || "";
    if (name) setReceivedBy(name);
  }, [user?.name, isEdit]);

  useEffect(() => {
    if (!selfEmployee) return;
    const yid = selfEmployee.yardId ?? null;
    setReceivedYardId(yid);
    const y = yid ? yardById[yid] : undefined;
    setReceivedLocationLabel(y?.name?.trim() || y?.code?.trim() || yid || "—");
    if (!isEdit && user?.name?.trim()) {
      // prefer employee formal name when available
      const empName = employeeFullName(selfEmployee);
      if (empName) setReceivedBy(empName);
    }
  }, [selfEmployee, yardById, isEdit, user?.name]);

  // When Received From location changes → autofill Party Name + Address from Location Master
  useEffect(() => {
    if (fromYardOrCheckpost !== "yes" || !fromLocationId) {
      setPartyLockedFromLocation(false);
      return;
    }
    const loc = yardById[fromLocationId];
    if (!loc) return;
    setFromParty(loc.partyName?.trim() || loc.name?.trim() || loc.code?.trim() || "");
    setFromAddress(loc.address?.trim() || "");
    setPartyLockedFromLocation(true);
  }, [fromYardOrCheckpost, fromLocationId, yardById]);

  useEffect(() => {
    if (fromYardOrCheckpost === "no") {
      setFromLocationId("");
      setPartyLockedFromLocation(false);
    }
  }, [fromYardOrCheckpost]);

  // Default Assigned to → Reporting Officer when Marked To pool changes
  useEffect(() => {
    if (isEdit) return;
    const ro = defaultRoId;
    if (!ro) return;
    if (assignedEmployeeId && assignedOptions.some((e) => e.id === assignedEmployeeId)) return;
    setAssignedEmployeeId(ro);
    const emp = assignedOptions.find((e) => e.id === ro) ?? defaultRoEmployee;
    if (emp) setAssignedTo(employeeFullName(emp) || emp.empId || emp.id);
  }, [defaultRoId, assignedOptions, defaultRoEmployee, assignedEmployeeId, isEdit]);

  useEffect(() => {
    if (inward) {
      setDiaryNo(inward.diaryNo ?? "");
      setReceivedDate(inward.receivedDate ?? localCalendarYmd());
      setFromParty(inward.fromParty ?? "");
      setFromAddress(inward.fromAddress ?? "");
      setSubject(inward.subject ?? "");
      setModeOfReceipt(inward.modeOfReceipt ?? "Hand");
      setStatus(inward.status ?? "Pending");
      setReceivedBy(inward.receivedBy ?? "");
      setAssignedTo(inward.assignedTo ?? "");
      setAssignedEmployeeId("");
      setDeadline(inward.deadline ?? "");
      setFileRef(inward.fileRef ?? "");
      if (inward.yardId) {
        setReceivedYardId(inward.yardId);
        const y = yardById[inward.yardId];
        if (y) setReceivedLocationLabel(y.name?.trim() || y.code?.trim() || inward.yardId);
      }
      // Heuristic: restore Received From if party/address match Location Master
      const matchLoc = yards.find((y) => {
        if (!isReceivedFromLocation(y)) return false;
        const party = String(inward.fromParty ?? "").trim().toLowerCase();
        const pn = String(y.partyName ?? "").trim().toLowerCase();
        const nm = String(y.name ?? "").trim().toLowerCase();
        return (pn && pn === party) || (nm && nm === party);
      });
      if (matchLoc) {
        setFromYardOrCheckpost("yes");
        setFromLocationId(matchLoc.id);
        setPartyLockedFromLocation(true);
      }
    }
  }, [inward, yardById, yards]);

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/ioms/dak/inward", {
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
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/dak/inward"] });
      toast({ title: "Inward created" });
      setLocation(`/correspondence/inward/${row.id}`);
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/ioms/dak/inward/${id}`, {
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
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/dak/inward"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/dak/inward", id] });
      toast({ title: "Inward updated" });
      setLocation(`/correspondence/inward/${id}`);
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (fromYardOrCheckpost === "yes" && !fromLocationId) {
      toast({
        title: "Select location",
        description: "Choose the Yard or Checkpost the correspondence is from.",
        variant: "destructive",
      });
      return;
    }
    if (!assignedTo.trim()) {
      toast({
        title: "Marked To required",
        description: "Select the employee the inward is assigned to.",
        variant: "destructive",
      });
      return;
    }
    const payload = {
      diaryNo: diaryNo || undefined,
      receivedDate: receivedDate || undefined,
      fromParty: fromParty || undefined,
      fromAddress: fromAddress || undefined,
      subject: subject || undefined,
      modeOfReceipt: modeOfReceipt || undefined,
      status: status || undefined,
      // Scope to the receiver's location (logged-in user), not the "from" yard/CP
      yardId: receivedYardId || undefined,
      receivedBy: receivedBy || undefined,
      assignedTo: assignedTo || undefined,
      deadline: deadline || undefined,
      fileRef: fileRef || undefined,
    };
    if (isEdit) updateMutation.mutate(payload);
    else createMutation.mutate(payload);
  };

  const loading = isEdit && inward === undefined && !inwardError;
  const saving = createMutation.isPending || updateMutation.isPending;

  if (isEdit && inwardError) {
    return (
      <AppShell breadcrumbs={[{ label: "Dak Inward", href: "/correspondence/inward" }, { label: "Edit" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Inward not found.</span>
            <Button variant="outline" size="sm" onClick={() => setLocation("/correspondence/inward")}>
              Back
            </Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  if (loading) {
    return (
      <AppShell breadcrumbs={[{ label: "Dak Inward", href: "/correspondence/inward" }, { label: "Edit" }]}>
        <Card>
          <CardContent className="p-6 flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading…</span>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell
      breadcrumbs={[
        { label: "Dak Inward", href: "/correspondence/inward" },
        { label: isEdit ? "Edit inward" : "Add inward" },
      ]}
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            {isEdit ? "Edit inward" : "Add inward"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4 max-w-3xl">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Inward No.</Label>
                <Input
                  value={diaryNo}
                  onChange={(e) => setDiaryNo(e.target.value)}
                  placeholder="Leave blank for auto"
                  readOnly={isEdit && !!inward?.diaryNo}
                />
              </div>
              <div>
                <Label>Received date *</Label>
                <Input
                  type="date"
                  value={receivedDate}
                  onChange={(e) => setReceivedDate(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
              <div className="space-y-2">
                <Label>Received from Yard / Checkpost / HO</Label>
                <RadioGroup
                  value={fromYardOrCheckpost}
                  onValueChange={(v) => setFromYardOrCheckpost(v as "yes" | "no")}
                  className="flex gap-4"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="yes" id="from-ycp-yes" />
                    <Label htmlFor="from-ycp-yes" className="font-normal cursor-pointer">
                      Yes
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="no" id="from-ycp-no" />
                    <Label htmlFor="from-ycp-no" className="font-normal cursor-pointer">
                      No
                    </Label>
                  </div>
                </RadioGroup>
              </div>
              <div>
                <Label>Select Location</Label>
                <Select
                  value={fromLocationId || "__none__"}
                  onValueChange={(v) => setFromLocationId(v === "__none__" ? "" : v)}
                  disabled={fromYardOrCheckpost !== "yes"}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Head Office / Yard / Checkpost…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select…</SelectItem>
                    {fromLocationOptions.map((y) => (
                      <SelectItem key={y.id} value={y.id}>
                        {y.name ?? y.code ?? y.id}
                        {y.type ? ` (${y.type})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fromYardOrCheckpost === "yes" ? (
                  <p className="text-xs text-muted-foreground mt-1">
                    All locations are listed (not limited by your posting). Party Name and Address autofill from Location
                    Master.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>From (Party) *</Label>
                <Input
                  value={fromParty}
                  onChange={(e) => setFromParty(e.target.value)}
                  required
                  readOnly={partyLockedFromLocation}
                />
              </div>
              <div>
                <Label>Mode of receipt</Label>
                <Select value={modeOfReceipt} onValueChange={setModeOfReceipt}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODES.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>From Address *</Label>
              <Input
                value={fromAddress}
                onChange={(e) => setFromAddress(e.target.value)}
                required
                readOnly={partyLockedFromLocation}
              />
            </div>

            <div>
              <Label>Subject *</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} required />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>File Reference No.</Label>
                <Input value={fileRef} onChange={(e) => setFileRef(e.target.value)} placeholder="Optional" />
              </div>
              <div>
                <Label>Deadline Date</Label>
                <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Received by</Label>
                <Input value={receivedBy} readOnly className="bg-muted/40" />
                <p className="text-xs text-muted-foreground mt-1">Logged-in employee (auto-filled)</p>
              </div>
              <div>
                <Label>Received Location</Label>
                <Input value={receivedLocationLabel || "—"} readOnly className="bg-muted/40" />
                <p className="text-xs text-muted-foreground mt-1">Logged-in user location (auto-filled)</p>
              </div>
            </div>

            <div className="rounded-md border p-4 space-y-3">
              <p className="text-sm font-medium">Marked To</p>
              <p className="text-xs text-muted-foreground">
                {userIsHo
                  ? "Head Office: choose a section, then an employee. The section Reporting Officer is selected by default."
                  : "Yard / Checkpost: employees at your location. The location Reporting Officer is selected by default."}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {userIsHo ? (
                  <div>
                    <Label>Section Name</Label>
                    <Select
                      value={sectionName || "__none__"}
                      onValueChange={(v) => {
                        setSectionName(v === "__none__" ? "" : v);
                        setAssignedEmployeeId("");
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Admin / Inspection / Accounts…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Select section…</SelectItem>
                        {HO_SECTIONS.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <div className={userIsHo ? "" : "md:col-span-2"}>
                  <Label>Assigned to *</Label>
                  <Select
                    value={assignedEmployeeId || "__none__"}
                    onValueChange={(v) => {
                      if (v === "__none__") {
                        setAssignedEmployeeId("");
                        setAssignedTo("");
                        return;
                      }
                      setAssignedEmployeeId(v);
                      const emp = assignedOptions.find((e) => e.id === v);
                      setAssignedTo(emp ? employeeFullName(emp) || emp.empId || emp.id : v);
                    }}
                    disabled={userIsHo && !sectionName.trim()}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={userIsHo && !sectionName ? "Select section first…" : "Select employee…"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Select…</SelectItem>
                      {assignedOptions.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {employeeFullName(e) || e.empId || e.id}
                          {e.empId ? ` (${e.empId})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="max-w-xs">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                type="submit"
                disabled={
                  saving ||
                  !receivedDate ||
                  !fromParty.trim() ||
                  !fromAddress.trim() ||
                  !subject.trim() ||
                  !assignedTo.trim()
                }
              >
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {isEdit ? "Update" : "Create"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setLocation(isEdit ? `/correspondence/inward/${id}` : "/correspondence/inward")
                }
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </AppShell>
  );
}
