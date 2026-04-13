import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { useScopedActiveYards } from "@/hooks/useScopedActiveYards";
import { ArrowLeft, FileCheck, Loader2, AlertCircle } from "lucide-react";
import {
  isValidEmailFormat,
  isStrictAadhaar12Digits,
  parseIndianMobile10Digits,
  sanitizeMobile10Input,
} from "@shared/india-validation";

const LICENCE_TYPES = ["Associated", "Functionary", "Hamali", "Weighman", "AssistantTrader"] as const;

interface LicenceRow {
  id: string;
  licenceNo?: string | null;
  firmName: string;
  firmType?: string | null;
  yardId: string;
  contactName?: string | null;
  mobile: string;
  email?: string | null;
  address?: string | null;
  aadhaarToken?: string | null;
  pan?: string | null;
  gstin?: string | null;
  licenceType: string;
  feeAmount?: number | null;
  validFrom?: string | null;
  validTo?: string | null;
  status: string;
  isNonGstEntity?: boolean | null;
  dvReturnRemarks?: string | null;
  workflowRevisionCount?: number | null;
}

async function readApiError(res: Response): Promise<string> {
  const t = await res.text();
  try {
    const j = JSON.parse(t) as { error?: string; message?: string };
    return j.message || j.error || t || res.statusText;
  } catch {
    return t || res.statusText;
  }
}

export default function TraderLicenceForm() {
  const params = useParams<{ id?: string }>();
  const editId = params.id;
  const isNew = !editId;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const canCreate = can("M-02", "Create");
  const canUpdate = can("M-02", "Update");

  const { data: yards = [], isLoading: yardsLoading } = useScopedActiveYards();
  const yardOptions = useMemo(
    () => yards.filter((y) => String(y.type ?? "").toLowerCase() === "yard"),
    [yards],
  );

  const [firmName, setFirmName] = useState("");
  const [firmType, setFirmType] = useState("");
  const [yardId, setYardId] = useState("");
  const [contactName, setContactName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  /** New application: optional 12-digit Aadhaar. Edit: optional replacement only (empty = keep stored value). */
  const [aadhaarInput, setAadhaarInput] = useState("");
  const [pan, setPan] = useState("");
  const [gstin, setGstin] = useState("");
  const [licenceType, setLicenceType] = useState<string>(LICENCE_TYPES[0]!);
  const [feeAmount, setFeeAmount] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [nonGst, setNonGst] = useState(false);

  const { data: licence, isLoading: licenceLoading } = useQuery<LicenceRow>({
    queryKey: ["/api/ioms/traders/licences", editId],
    enabled: Boolean(editId),
  });

  const issued = Boolean(licence?.licenceNo && String(licence.licenceNo).trim());

  useEffect(() => {
    if (!licence) return;
    setFirmName(licence.firmName ?? "");
    setFirmType(licence.firmType ?? "");
    setYardId(licence.yardId ?? "");
    setContactName(licence.contactName ?? "");
    setMobile(sanitizeMobile10Input(licence.mobile ?? ""));
    setEmail(licence.email ?? "");
    setAddress(licence.address ?? "");
    setAadhaarInput("");
    setPan(licence.pan ?? "");
    setGstin(licence.gstin ?? "");
    setLicenceType(licence.licenceType || LICENCE_TYPES[0]!);
    setFeeAmount(licence.feeAmount != null ? String(licence.feeAmount) : "");
    setValidFrom(licence.validFrom?.slice(0, 10) ?? "");
    setValidTo(licence.validTo?.slice(0, 10) ?? "");
    setNonGst(Boolean(licence.isNonGstEntity));
  }, [licence]);

  const buildPayload = (status: "Draft" | "Pending"): Record<string, unknown> => {
    const mobileDigits = parseIndianMobile10Digits(mobile);
    const fee =
      feeAmount.trim() === "" ? null : Number(feeAmount);
    const aTrim = aadhaarInput.trim();
    const base: Record<string, unknown> = {
      firmName: firmName.trim(),
      firmType: firmType.trim() || null,
      yardId,
      contactName: contactName.trim() || null,
      mobile: mobileDigits,
      email: email.trim() ? email.trim().toLowerCase() : null,
      address: address.trim() || null,
      pan: pan.trim() || null,
      gstin: gstin.trim() || null,
      licenceType,
      feeAmount: fee != null && Number.isFinite(fee) ? fee : null,
      validFrom: validFrom.trim() || null,
      validTo: validTo.trim() || null,
      status,
      isNonGstEntity: nonGst,
    };
    if (isNew) {
      base.aadhaarToken = aTrim || null;
    } else if (aTrim) {
      base.aadhaarToken = aTrim;
    }
    return base;
  };

  const validate = (): boolean => {
    if (!firmName.trim()) {
      toast({ title: "Validation", description: "Firm / trader name is required.", variant: "destructive" });
      return false;
    }
    if (!yardId) {
      toast({ title: "Validation", description: "Select a yard.", variant: "destructive" });
      return false;
    }
    const mobileDigits = parseIndianMobile10Digits(mobile);
    if (!mobileDigits) {
      toast({ title: "Validation", description: "Enter a valid 10-digit mobile number.", variant: "destructive" });
      return false;
    }
    if (email.trim() && !isValidEmailFormat(email.trim())) {
      toast({ title: "Validation", description: "Enter a valid email or leave it blank.", variant: "destructive" });
      return false;
    }
    const aTrim = aadhaarInput.trim();
    if (aTrim && !isStrictAadhaar12Digits(aTrim)) {
      toast({
        title: "Validation",
        description: "Aadhaar must be exactly 12 digits when entered.",
        variant: "destructive",
      });
      return false;
    }
    return true;
  };

  const saveMutation = useMutation({
    mutationFn: async ({ status }: { status: "Draft" | "Pending" }) => {
      const payload = buildPayload(status);
      if (isNew) {
        const res = await fetch("/api/ioms/traders/licences", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await readApiError(res));
        return (await res.json()) as LicenceRow;
      }
      const res = await fetch(`/api/ioms/traders/licences/${editId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await readApiError(res));
      return (await res.json()) as LicenceRow;
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/traders/licences"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ioms/traders/licences", row.id] });
      toast({ title: "Saved", description: "Licence application saved." });
      if (isNew) {
        setLocation(`/traders/licences/${row.id}`);
      } else {
        setLocation(`/traders/licences/${row.id}`);
      }
    },
    onError: (e: Error) => {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    },
  });

  if (!isNew && !canUpdate) {
    return (
      <AppShell breadcrumbs={[{ label: "Licences", href: "/traders/licences" }, { label: "Edit" }]}>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Not allowed</AlertTitle>
          <AlertDescription>You do not have permission to edit licences.</AlertDescription>
        </Alert>
      </AppShell>
    );
  }

  if (isNew && !canCreate) {
    return (
      <AppShell breadcrumbs={[{ label: "Licences", href: "/traders/licences" }, { label: "New" }]}>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Not allowed</AlertTitle>
          <AlertDescription>You do not have permission to create licences.</AlertDescription>
        </Alert>
      </AppShell>
    );
  }

  if (!isNew && licenceLoading) {
    return (
      <AppShell breadcrumbs={[{ label: "Licences", href: "/traders/licences" }, { label: "Edit" }]}>
        <Skeleton className="h-96 w-full max-w-3xl" />
      </AppShell>
    );
  }

  if (!isNew && issued) {
    return (
      <AppShell breadcrumbs={[{ label: "Licences", href: "/traders/licences" }, { label: "Edit" }]}>
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>Licence issued</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This application has a licence number and can no longer be edited. Open the record to view details.
            </p>
            <Button asChild>
              <Link href={`/traders/licences/${editId}`}>View licence</Link>
            </Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const saving = saveMutation.isPending;
  const onSave = (status: "Draft" | "Pending") => {
    if (!validate()) return;
    saveMutation.mutate({ status });
  };

  return (
    <AppShell
      breadcrumbs={[
        { label: "Licences", href: "/traders/licences" },
        { label: isNew ? "Apply for new licence" : "Edit application" },
      ]}
    >
      <div className="max-w-3xl space-y-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/traders/licences">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to list
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileCheck className="h-5 w-5" />
              {isNew ? "Apply for new licence (M-02)" : "Edit licence application"}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Save a draft anytime, or submit for review. If the application was returned in query mode, update the fields
              and submit again — revisions are recorded in the audit trail.
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            {!isNew && licence?.status === "Query" && licence.dvReturnRemarks ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Returned for correction</AlertTitle>
                <AlertDescription className="whitespace-pre-wrap">{licence.dvReturnRemarks}</AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Firm / trader name *</Label>
                <Input value={firmName} onChange={(e) => setFirmName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Firm type</Label>
                <Input value={firmType} onChange={(e) => setFirmType(e.target.value)} placeholder="e.g. Partnership" />
              </div>
              <div className="space-y-2">
                <Label>Yard *</Label>
                <Select value={yardId || "__none__"} onValueChange={(v) => setYardId(v === "__none__" ? "" : v)} disabled={yardsLoading}>
                  <SelectTrigger>
                    <SelectValue placeholder={yardsLoading ? "Loading…" : "Select yard"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Select…</SelectItem>
                    {yardOptions.map((y) => (
                      <SelectItem key={y.id} value={y.id}>
                        {y.code ? `${y.code} — ${y.name}` : y.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Contact name</Label>
                <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Licence type *</Label>
                <Select value={licenceType} onValueChange={setLicenceType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LICENCE_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Mobile *</Label>
                <Input
                  value={mobile}
                  onChange={(e) => setMobile(sanitizeMobile10Input(e.target.value))}
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="10-digit mobile"
                  autoComplete="tel-national"
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Address</Label>
                <Textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Aadhaar</Label>
                {!isNew && licence?.aadhaarToken ? (
                  <p className="text-sm text-muted-foreground rounded-md border bg-muted/40 px-3 py-2">
                    On file (masked):{" "}
                    <span className="font-mono tabular-nums text-foreground">{licence.aadhaarToken}</span>
                    . Leave the field below empty to keep it; enter 12 digits only to replace.
                  </p>
                ) : null}
                <Input
                  value={aadhaarInput}
                  onChange={(e) => setAadhaarInput(e.target.value.replace(/\D/g, "").slice(0, 12))}
                  inputMode="numeric"
                  maxLength={12}
                  placeholder={
                    isNew
                      ? "Optional — 12 digits"
                      : licence?.aadhaarToken
                        ? "Optional — 12 digits to replace stored Aadhaar"
                        : "Optional — 12 digits"
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>PAN</Label>
                <Input value={pan} onChange={(e) => setPan(e.target.value)} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>GSTIN</Label>
                <Input value={gstin} onChange={(e) => setGstin(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Fee amount (₹)</Label>
                <Input value={feeAmount} onChange={(e) => setFeeAmount(e.target.value)} inputMode="decimal" />
              </div>
              <div className="space-y-2">
                <Label>Valid from</Label>
                <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Valid to</Label>
                <Input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
              </div>
              <div className="flex items-center gap-2 sm:col-span-2">
                <Checkbox id="non-gst" checked={nonGst} onCheckedChange={(c) => setNonGst(c === true)} />
                <Label htmlFor="non-gst" className="font-normal cursor-pointer">
                  Declared non-GST entity
                </Label>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-2 border-t">
              <Button type="button" variant="secondary" disabled={saving} onClick={() => onSave("Draft")}>
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Save draft
              </Button>
              <Button type="button" disabled={saving} onClick={() => onSave("Pending")}>
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                {licence?.status === "Query" ? "Resubmit for review" : "Submit for review"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
