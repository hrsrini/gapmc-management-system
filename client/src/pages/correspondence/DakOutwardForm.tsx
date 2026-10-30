import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
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
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { localCalendarYmd } from "@shared/premises-allocation";
import type { DakRecipientRow } from "@shared/dak-recipients";
import { Send, Loader2, Plus, Trash2 } from "lucide-react";

interface Yard {
  id: string;
  code?: string | null;
  name?: string | null;
  type?: string | null;
  address?: string | null;
  partyName?: string | null;
}

interface EmployeeRef {
  id: string;
  empId?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  surname?: string | null;
  yardId?: string | null;
}

const MODES = ["Post", "Courier", "Hand", "Email", "Fax"];

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

function isOfficeLocation(y: { type?: string | null; name?: string | null; code?: string | null } | undefined): boolean {
  return isYardOrCheckPost(y) || isHeadOfficeYard(y);
}

function employeeFullName(e: EmployeeRef): string {
  return [e.firstName, e.middleName, e.surname].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function emptyExternalRow(): DakRecipientRow {
  return { name: "", address: "", locationId: null };
}

function recipientsFromLocationIds(ids: string[], yardById: Record<string, Yard>): DakRecipientRow[] {
  const out: DakRecipientRow[] = [];
  for (const id of ids) {
    const loc = yardById[id];
    if (!loc) continue;
    const name = loc.partyName?.trim() || loc.name?.trim() || loc.code?.trim() || "";
    if (!name) continue;
    out.push({
      name,
      address: loc.address?.trim() || "",
      locationId: id,
    });
  }
  return out;
}

type RecipientBlockProps = {
  title: string;
  internalLabel: string;
  mode: "yes" | "no";
  onModeChange: (v: "yes" | "no") => void;
  externalRows: DakRecipientRow[];
  onExternalRowsChange: (rows: DakRecipientRow[]) => void;
  selectedLocationIds: string[];
  onSelectedLocationIdsChange: (ids: string[]) => void;
  locationOptions: Yard[];
  addRowLabel: string;
};

function RecipientBlock({
  title,
  internalLabel,
  mode,
  onModeChange,
  externalRows,
  onExternalRowsChange,
  selectedLocationIds,
  onSelectedLocationIdsChange,
  locationOptions,
  addRowLabel,
}: RecipientBlockProps) {
  const allIds = locationOptions.map((y) => y.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedLocationIds.includes(id));

  function toggleLocation(id: string, checked: boolean) {
    if (checked) onSelectedLocationIdsChange([...selectedLocationIds, id]);
    else onSelectedLocationIdsChange(selectedLocationIds.filter((x) => x !== id));
  }

  function toggleSelectAll(checked: boolean) {
    onSelectedLocationIdsChange(checked ? allIds : []);
  }

  function updateExternal(i: number, patch: Partial<DakRecipientRow>) {
    onExternalRowsChange(externalRows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function removeExternal(i: number) {
    if (externalRows.length <= 1) {
      onExternalRowsChange([emptyExternalRow()]);
      return;
    }
    onExternalRowsChange(externalRows.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-sm font-medium">{title}</p>
      <div className="space-y-2">
        <Label>{internalLabel}</Label>
        <RadioGroup
          value={mode}
          onValueChange={(v) => onModeChange(v === "yes" ? "yes" : "no")}
          className="flex flex-wrap gap-4"
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="yes" id={`${title}-yes`} />
            <Label htmlFor={`${title}-yes`} className="font-normal cursor-pointer">
              Yes
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="no" id={`${title}-no`} />
            <Label htmlFor={`${title}-no`} className="font-normal cursor-pointer">
              No
            </Label>
          </div>
        </RadioGroup>
      </div>

      {mode === "yes" ? (
        <div className="space-y-2 max-h-56 overflow-y-auto rounded border bg-muted/20 p-2">
          <div className="flex items-center gap-2 pb-1 border-b">
            <Checkbox
              id={`${title}-select-all`}
              checked={allSelected}
              onCheckedChange={(c) => toggleSelectAll(c === true)}
            />
            <Label htmlFor={`${title}-select-all`} className="font-normal cursor-pointer text-sm">
              Select all locations
            </Label>
          </div>
          {locationOptions.map((loc) => {
            const checked = selectedLocationIds.includes(loc.id);
            const party = loc.partyName?.trim() || loc.name?.trim() || loc.code?.trim() || loc.id;
            return (
              <div key={loc.id} className="flex items-start gap-2 py-1">
                <Checkbox
                  id={`${title}-loc-${loc.id}`}
                  checked={checked}
                  onCheckedChange={(c) => toggleLocation(loc.id, c === true)}
                  className="mt-0.5"
                />
                <Label htmlFor={`${title}-loc-${loc.id}`} className="font-normal cursor-pointer text-sm leading-snug">
                  <span className="font-medium">{loc.name ?? loc.code ?? loc.id}</span>
                  <span className="block text-xs text-muted-foreground">
                    {party}
                    {loc.address?.trim() ? ` — ${loc.address.trim()}` : ""}
                  </span>
                </Label>
              </div>
            );
          })}
          {locationOptions.length === 0 && (
            <p className="text-xs text-muted-foreground">No yards / checkposts / head office in Location Master.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="hidden sm:grid grid-cols-[1fr_1fr_auto] gap-2 text-xs text-muted-foreground px-0.5">
            <span>Name</span>
            <span>Address</span>
            <span className="w-9" />
          </div>
          {externalRows.map((row, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-center">
              <Input
                placeholder="Name"
                value={row.name}
                onChange={(e) => updateExternal(i, { name: e.target.value, locationId: null })}
                aria-label={`${title} name ${i + 1}`}
              />
              <Input
                placeholder="Address"
                value={row.address}
                onChange={(e) => updateExternal(i, { address: e.target.value, locationId: null })}
                aria-label={`${title} address ${i + 1}`}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={() => removeExternal(i)}
                aria-label={`Remove ${title} row ${i + 1}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onExternalRowsChange([...externalRows, emptyExternalRow()])}
          >
            <Plus className="h-4 w-4 mr-1" />
            {addRowLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

export default function DakOutwardForm() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [despatchNo, setDespatchNo] = useState("");
  const [despatchDate, setDespatchDate] = useState(() => localCalendarYmd());
  const [fileRef, setFileRef] = useState("");
  const [modeOfDespatch, setModeOfDespatch] = useState("Post");
  const [subject, setSubject] = useState("");
  const [despatchedBy, setDespatchedBy] = useState("");
  const [outwardLocationLabel, setOutwardLocationLabel] = useState("");
  const [outwardYardId, setOutwardYardId] = useState<string | null>(null);

  const [toInternal, setToInternal] = useState<"yes" | "no">("no");
  const [toExternalRows, setToExternalRows] = useState<DakRecipientRow[]>([emptyExternalRow()]);
  const [toLocationIds, setToLocationIds] = useState<string[]>([]);

  const [copyInternal, setCopyInternal] = useState<"yes" | "no">("no");
  const [copyExternalRows, setCopyExternalRows] = useState<DakRecipientRow[]>([emptyExternalRow()]);
  const [copyLocationIds, setCopyLocationIds] = useState<string[]>([]);

  const { data: yards = [] } = useQuery<Yard[]>({ queryKey: ["/api/yards"] });

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

  const locationOptions = useMemo(
    () =>
      yards
        .filter((y) => isOfficeLocation(y))
        .sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [yards],
  );

  useEffect(() => {
    const name = user?.name?.trim() || "";
    if (name) setDespatchedBy(name);
  }, [user?.name]);

  useEffect(() => {
    if (!selfEmployee) return;
    const yid = selfEmployee.yardId ?? null;
    setOutwardYardId(yid);
    const y = yid ? yardById[yid] : undefined;
    setOutwardLocationLabel(y?.name?.trim() || y?.code?.trim() || yid || "—");
    const empName = employeeFullName(selfEmployee);
    if (empName) setDespatchedBy(empName);
  }, [selfEmployee, yardById]);

  const toRecipients = useMemo(() => {
    if (toInternal === "yes") return recipientsFromLocationIds(toLocationIds, yardById);
    return toExternalRows
      .map((r) => ({
        name: r.name.trim(),
        address: r.address.trim(),
        locationId: null as string | null,
      }))
      .filter((r) => r.name);
  }, [toInternal, toLocationIds, toExternalRows, yardById]);

  const copyToRecipients = useMemo(() => {
    if (copyInternal === "yes") return recipientsFromLocationIds(copyLocationIds, yardById);
    return copyExternalRows
      .map((r) => ({
        name: r.name.trim(),
        address: r.address.trim(),
        locationId: null as string | null,
      }))
      .filter((r) => r.name);
  }, [copyInternal, copyLocationIds, copyExternalRows, yardById]);

  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/ioms/dak/outward", {
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
    onSuccess: (row: { id: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/dak/outward"] });
      toast({ title: "Outward created" });
      setLocation(`/correspondence/outward/${row.id}`);
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!despatchDate) {
      toast({ title: "Outward Date required", variant: "destructive" });
      return;
    }
    if (toRecipients.length === 0) {
      toast({
        title: "To recipient required",
        description:
          toInternal === "yes"
            ? "Select at least one location."
            : "Enter at least one To name (and address).",
        variant: "destructive",
      });
      return;
    }
    if (!subject.trim()) {
      toast({ title: "Subject required", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      despatchNo: despatchNo || undefined,
      despatchDate,
      toRecipients,
      copyTo: copyToRecipients,
      subject: subject.trim(),
      modeOfDespatch: modeOfDespatch || undefined,
      yardId: outwardYardId || undefined,
      fileRef: fileRef || undefined,
      despatchedBy: despatchedBy || undefined,
    });
  };

  const canSubmit =
    Boolean(despatchDate) && toRecipients.length > 0 && Boolean(subject.trim()) && !createMutation.isPending;

  return (
    <AppShell breadcrumbs={[{ label: "Tapal Outward", href: "/correspondence/outward" }, { label: "Add outward" }]}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Add outward
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4 max-w-3xl">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Outward No. (OUT-LOC-YYYY-NNNNN)</Label>
                <Input
                  value={despatchNo}
                  onChange={(e) => setDespatchNo(e.target.value)}
                  placeholder="Leave blank for auto"
                />
              </div>
              <div>
                <Label>Outward Date *</Label>
                <Input
                  type="date"
                  value={despatchDate}
                  onChange={(e) => setDespatchDate(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground mt-1">Defaults to today; editable.</p>
              </div>
              <div>
                <Label>File Reference No.</Label>
                <Input
                  value={fileRef}
                  onChange={(e) => setFileRef(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div>
                <Label>Mode of Despatch</Label>
                <Select value={modeOfDespatch} onValueChange={setModeOfDespatch}>
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

            <RecipientBlock
              title="To"
              internalLabel="To Yard / Checkpost / Head Office"
              mode={toInternal}
              onModeChange={(v) => {
                setToInternal(v);
                if (v === "no" && toExternalRows.length === 0) setToExternalRows([emptyExternalRow()]);
                if (v === "yes") setToLocationIds([]);
              }}
              externalRows={toExternalRows}
              onExternalRowsChange={setToExternalRows}
              selectedLocationIds={toLocationIds}
              onSelectedLocationIdsChange={setToLocationIds}
              locationOptions={locationOptions}
              addRowLabel="Add To row"
            />

            <RecipientBlock
              title="Copy To"
              internalLabel="Copy To Yard / Checkpost / Head Office"
              mode={copyInternal}
              onModeChange={(v) => {
                setCopyInternal(v);
                if (v === "no" && copyExternalRows.length === 0) setCopyExternalRows([emptyExternalRow()]);
                if (v === "yes") setCopyLocationIds([]);
              }}
              externalRows={copyExternalRows}
              onExternalRowsChange={setCopyExternalRows}
              selectedLocationIds={copyLocationIds}
              onSelectedLocationIdsChange={setCopyLocationIds}
              locationOptions={locationOptions}
              addRowLabel="Add Copy To row"
            />

            <div>
              <Label>Subject *</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} required />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Despatched by</Label>
                <Input value={despatchedBy} readOnly className="bg-muted/40" />
                <p className="text-xs text-muted-foreground mt-1">Logged-in employee (auto-filled).</p>
              </div>
              <div>
                <Label>Outward Location</Label>
                <Input value={outwardLocationLabel} readOnly className="bg-muted/40" />
                <p className="text-xs text-muted-foreground mt-1">Logged-in user location (auto-filled).</p>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={!canSubmit}>
                {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create
              </Button>
              <Button type="button" variant="outline" onClick={() => setLocation("/correspondence/outward")}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </AppShell>
  );
}
