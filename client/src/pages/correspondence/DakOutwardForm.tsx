import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
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
import { Send, Loader2, Plus, Trash2, AlertCircle } from "lucide-react";

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

interface OutwardRecord {
  id: string;
  despatchNo?: string | null;
  despatchDate: string;
  subject: string;
  modeOfDespatch: string;
  yardId?: string | null;
  fileRef?: string | null;
  despatchedBy?: string | null;
  toRecipientsJson?: DakRecipientRow[] | null;
  copyToJson?: DakRecipientRow[] | null;
  toParty?: string | null;
  toAddress?: string | null;
}

function normText(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Match a freeform recipient row back to Location Master when locationId was not stored. */
function matchRecipientToYard(r: DakRecipientRow, yards: Yard[]): string | null {
  const party = normText(r.name ?? "");
  const addr = normText(r.address ?? "");
  if (!party && !addr) return null;
  const byAddress = addr
    ? yards.filter((y) => {
        const ya = normText(String(y.address ?? ""));
        return ya && (ya === addr || addr.includes(ya) || ya.includes(addr));
      })
    : [];
  if (byAddress.length === 1) return byAddress[0]!.id;
  if (byAddress.length > 1 && party) {
    const hit = byAddress.find((y) => {
      const pn = normText(String(y.partyName ?? ""));
      const nm = normText(String(y.name ?? ""));
      return (pn && pn === party) || (nm && nm === party);
    });
    if (hit) return hit.id;
  }
  const partyHits = party
    ? yards.filter((y) => {
        const pn = normText(String(y.partyName ?? ""));
        const nm = normText(String(y.name ?? ""));
        return (pn && pn === party) || (nm && nm === party);
      })
    : [];
  if (partyHits.length === 1) return partyHits[0]!.id;
  return null;
}

/** Split saved To/Copy-To rows into location checkbox ids + freeform Name/Address rows. */
function splitRecipientsForEdit(
  rows: DakRecipientRow[] | null | undefined,
  yards: Yard[],
): { locationIds: string[]; external: DakRecipientRow[]; mode: "yes" | "no" } {
  const list = Array.isArray(rows) ? rows : [];
  const locationIds: string[] = [];
  const external: DakRecipientRow[] = [];
  const seen = new Set<string>();
  for (const r of list) {
    let locId = String(r.locationId ?? "").trim();
    if (!locId && yards.length > 0) {
      locId = matchRecipientToYard(r, yards) ?? "";
    }
    if (locId && !seen.has(locId) && (yards.length === 0 || yards.some((y) => y.id === locId))) {
      seen.add(locId);
      locationIds.push(locId);
      continue;
    }
    if (String(r.name ?? "").trim()) {
      external.push({
        name: String(r.name ?? "").trim(),
        address: String(r.address ?? "").trim(),
        locationId: null,
      });
    }
  }
  return {
    locationIds,
    external: external.length > 0 ? external : [emptyExternalRow()],
    mode: locationIds.length > 0 ? "yes" : "no",
  };
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
  /** Locations that cannot be chosen (e.g. already in To — hide/disable in Copy To). */
  disabledLocationIds?: string[];
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
  disabledLocationIds = [],
  addRowLabel,
}: RecipientBlockProps) {
  const disabled = useMemo(() => new Set(disabledLocationIds), [disabledLocationIds]);
  const selectableIds = useMemo(
    () => locationOptions.map((y) => y.id).filter((id) => !disabled.has(id)),
    [locationOptions, disabled],
  );
  const allSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedLocationIds.includes(id));

  function toggleLocation(id: string, checked: boolean) {
    if (disabled.has(id)) return;
    if (checked) onSelectedLocationIdsChange([...selectedLocationIds, id]);
    else onSelectedLocationIdsChange(selectedLocationIds.filter((x) => x !== id));
  }

  function toggleSelectAll(checked: boolean) {
    onSelectedLocationIdsChange(checked ? selectableIds : []);
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
          <p className="text-xs text-muted-foreground">
            Select Yard / Checkpost / Head Office locations (multiple allowed). You can also add Name /
            Address rows below for additional recipients.
          </p>
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
            const isDisabled = disabled.has(loc.id);
            const checked = selectedLocationIds.includes(loc.id);
            const party = loc.partyName?.trim() || loc.name?.trim() || loc.code?.trim() || loc.id;
            return (
              <div
                key={loc.id}
                className={`flex items-start gap-2 py-1 ${isDisabled ? "opacity-50" : ""}`}
              >
                <Checkbox
                  id={`${title}-loc-${loc.id}`}
                  checked={checked && !isDisabled}
                  disabled={isDisabled}
                  onCheckedChange={(c) => toggleLocation(loc.id, c === true)}
                  className="mt-0.5"
                />
                <Label
                  htmlFor={`${title}-loc-${loc.id}`}
                  className={`font-normal text-sm leading-snug ${isDisabled ? "cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <span className="font-medium">{loc.name ?? loc.code ?? loc.id}</span>
                  <span className="block text-xs text-muted-foreground">
                    {isDisabled
                      ? "Already selected under To — cannot also mark Copy To"
                      : `${party}${loc.address?.trim() ? ` — ${loc.address.trim()}` : ""}`}
                  </span>
                </Label>
              </div>
            );
          })}
          {locationOptions.length === 0 && (
            <p className="text-xs text-muted-foreground">No yards / checkposts / head office in Location Master.</p>
          )}
        </div>
      ) : null}

      {/* Name/Address rows + Add Row — available for both Yes and No (FRD multi-recipient). */}
      <div className="space-y-2">
        {mode === "yes" ? (
          <p className="text-xs font-medium text-muted-foreground">Additional Name / Address rows</p>
        ) : null}
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
    </div>
  );
}

export default function DakOutwardForm() {
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
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

  /** All active locations (not limited by logged-in employee's posting). */
  const { data: yards = [] } = useQuery<Yard[]>({
    queryKey: ["/api/yards/for-correspondence"],
    queryFn: async () => {
      const res = await fetch("/api/yards/for-correspondence", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load locations");
      return res.json();
    },
  });

  const { data: outward, isError: outwardError } = useQuery<OutwardRecord>({
    queryKey: ["/api/ioms/dak/outward", id],
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

  // All active locations from API — do not filter by posting or by type (Yard/HO/Checkpost).
  const locationOptions = useMemo(
    () => yards.slice().sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [yards],
  );

  // Drop Copy To locations that were later chosen under To.
  useEffect(() => {
    if (toLocationIds.length === 0) return;
    const blocked = new Set(toLocationIds);
    setCopyLocationIds((prev) => {
      const next = prev.filter((id) => !blocked.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [toLocationIds]);

  useEffect(() => {
    if (isEdit) return;
    const name = user?.name?.trim() || "";
    if (name) setDespatchedBy(name);
  }, [user?.name, isEdit]);

  useEffect(() => {
    if (!selfEmployee) return;
    if (isEdit && outward) {
      // Keep original despatch location / by on edit; only fill label if missing.
      const yid = outward.yardId ?? selfEmployee.yardId ?? null;
      setOutwardYardId(yid);
      const y = yid ? yardById[yid] : undefined;
      setOutwardLocationLabel(y?.name?.trim() || y?.code?.trim() || yid || "—");
      if (outward.despatchedBy) setDespatchedBy(outward.despatchedBy);
      return;
    }
    if (isEdit) return;
    const yid = selfEmployee.yardId ?? null;
    setOutwardYardId(yid);
    const y = yid ? yardById[yid] : undefined;
    setOutwardLocationLabel(y?.name?.trim() || y?.code?.trim() || yid || "—");
    const empName = employeeFullName(selfEmployee);
    if (empName) setDespatchedBy(empName);
  }, [selfEmployee, yardById, isEdit, outward]);

  // Prefill edit form including To / Copy To location checkboxes.
  useEffect(() => {
    if (!outward) return;
    setDespatchNo(outward.despatchNo ?? "");
    setDespatchDate(outward.despatchDate ?? localCalendarYmd());
    setFileRef(outward.fileRef ?? "");
    setModeOfDespatch(outward.modeOfDespatch || "Post");
    setSubject(outward.subject ?? "");
    if (outward.despatchedBy) setDespatchedBy(outward.despatchedBy);
    if (outward.yardId) {
      setOutwardYardId(outward.yardId);
      const y = yardById[outward.yardId];
      if (y) setOutwardLocationLabel(y.name?.trim() || y.code?.trim() || outward.yardId);
    }

    const toRows =
      outward.toRecipientsJson && outward.toRecipientsJson.length > 0
        ? outward.toRecipientsJson
        : outward.toParty
          ? [{ name: outward.toParty, address: outward.toAddress ?? "", locationId: null }]
          : [];
    const toSplit = splitRecipientsForEdit(toRows, yards);
    setToInternal(toSplit.mode);
    setToLocationIds(toSplit.locationIds);
    setToExternalRows(toSplit.external);

    const copySplit = splitRecipientsForEdit(outward.copyToJson, yards);
    setCopyInternal(copySplit.mode);
    setCopyLocationIds(copySplit.locationIds);
    setCopyExternalRows(copySplit.external);
  }, [outward, yards, yardById]);

  const manualRows = (rows: DakRecipientRow[]) =>
    rows
      .map((r) => ({
        name: r.name.trim(),
        address: r.address.trim(),
        locationId: null as string | null,
      }))
      .filter((r) => r.name);

  const toRecipients = useMemo(() => {
    const fromLocations =
      toInternal === "yes" ? recipientsFromLocationIds(toLocationIds, yardById) : [];
    const fromRows = manualRows(toExternalRows);
    // Prefer location-linked rows first; append freeform Name/Address entries.
    return [...fromLocations, ...fromRows];
  }, [toInternal, toLocationIds, toExternalRows, yardById]);

  const copyToRecipients = useMemo(() => {
    const fromLocations =
      copyInternal === "yes" ? recipientsFromLocationIds(copyLocationIds, yardById) : [];
    const fromRows = manualRows(copyExternalRows);
    return [...fromLocations, ...fromRows];
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

  const updateMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/ioms/dak/outward/${id}`, {
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
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/dak/outward"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/dak/outward", id] });
      toast({ title: "Outward updated" });
      setLocation(`/correspondence/outward/${id}`);
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
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
            ? "Select at least one location and/or enter a To name."
            : "Enter at least one To name (and address).",
        variant: "destructive",
      });
      return;
    }
    if (!subject.trim()) {
      toast({ title: "Subject required", variant: "destructive" });
      return;
    }
    const payload = {
      despatchNo: despatchNo || undefined,
      despatchDate,
      toRecipients,
      copyTo: copyToRecipients,
      subject: subject.trim(),
      modeOfDespatch: modeOfDespatch || undefined,
      yardId: outwardYardId || undefined,
      fileRef: fileRef || undefined,
      despatchedBy: despatchedBy || undefined,
    };
    if (isEdit) updateMutation.mutate(payload);
    else createMutation.mutate(payload);
  };

  const saving = createMutation.isPending || updateMutation.isPending;
  const canSubmit =
    Boolean(despatchDate) && toRecipients.length > 0 && Boolean(subject.trim()) && !saving;

  const loading = isEdit && outward === undefined && !outwardError;
  if (isEdit && outwardError) {
    return (
      <AppShell breadcrumbs={[{ label: "Tapal Outward", href: "/correspondence/outward" }, { label: "Edit" }]}>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <span className="text-destructive">Outward not found.</span>
            <Button variant="outline" size="sm" onClick={() => setLocation("/correspondence/outward")}>
              Back to list
            </Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }
  if (loading) {
    return (
      <AppShell breadcrumbs={[{ label: "Tapal Outward", href: "/correspondence/outward" }, { label: "Edit" }]}>
        <Card>
          <CardContent className="p-6 flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading outward…
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell
      breadcrumbs={[
        { label: "Tapal Outward", href: "/correspondence/outward" },
        { label: isEdit ? "Edit outward" : "Add outward" },
      ]}
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            {isEdit ? "Edit outward" : "Add outward"}
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
                  readOnly={isEdit && !!outward?.despatchNo}
                  className={isEdit && outward?.despatchNo ? "bg-muted/40" : undefined}
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

            <div>
              <Label>Subject *</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} required />
            </div>

            <RecipientBlock
              title="To"
              internalLabel="To Yard / Checkpost / Head Office"
              mode={toInternal}
              onModeChange={(v) => {
                setToInternal(v);
                if (toExternalRows.length === 0) setToExternalRows([emptyExternalRow()]);
                // Clear location picks only when switching to No (keep selections when Yes).
                if (v === "no") setToLocationIds([]);
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
                if (copyExternalRows.length === 0) setCopyExternalRows([emptyExternalRow()]);
                if (v === "no") setCopyLocationIds([]);
              }}
              externalRows={copyExternalRows}
              onExternalRowsChange={setCopyExternalRows}
              selectedLocationIds={copyLocationIds}
              onSelectedLocationIdsChange={setCopyLocationIds}
              locationOptions={locationOptions}
              disabledLocationIds={toInternal === "yes" ? toLocationIds : []}
              addRowLabel="Add Copy To row"
            />

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
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {isEdit ? "Update" : "Create"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation(isEdit ? `/correspondence/outward/${id}` : "/correspondence/outward")}
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
