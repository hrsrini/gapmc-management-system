import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Banknote, Building2, Info, Landmark, Lock } from "lucide-react";
import { COMMON_INDIAN_BANKS } from "@shared/dues-counter-payment";
import type { PaymentPreferenceValue } from "@/lib/duesCounterPayment";
import type { DuesPaymentTypeUi } from "@shared/dues-counter-payment";

const PAYMENT_TYPES: {
  id: DuesPaymentTypeUi;
  title: string;
  description: string;
  icon: typeof Banknote;
}[] = [
  {
    id: "Cash",
    title: "Cash",
    description: "Pay in cash at any supervisor office.",
    icon: Banknote,
  },
  {
    id: "Cheque",
    title: "Cheque",
    description: "Provide cheque details for verification.",
    icon: Landmark,
  },
  {
    id: "NeftRtgs",
    title: "NEFT / RTGS",
    description: "Provide bank transaction reference details.",
    icon: Building2,
  },
];

function typeBannerLabel(type: DuesPaymentTypeUi): string {
  if (type === "Cash") return "cash";
  if (type === "Cheque") return "cheque";
  return "NEFT / RTGS";
}

export interface PaymentPreferenceFormProps {
  value: PaymentPreferenceValue;
  onChange: (next: PaymentPreferenceValue) => void;
  receivedByLabel: string;
  receivedAtLabel: string;
  /** When set, sync paid amount from summary step (user can still edit). */
  summaryAmount?: string;
}

export function PaymentPreferenceForm({
  value,
  onChange,
  receivedByLabel,
  receivedAtLabel,
  summaryAmount,
}: PaymentPreferenceFormProps) {
  const set = (patch: Partial<PaymentPreferenceValue>) => onChange({ ...value, ...patch });

  const paidAmount = summaryAmount ?? value.paidAmount;

  return (
    <div className="space-y-4 max-h-[min(70vh,640px)] overflow-y-auto pr-1">
      <div>
        <h3 className="text-sm font-semibold">Payment Preference</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Payment Type <span className="text-destructive">*</span>
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
          {PAYMENT_TYPES.map((pt) => {
            const Icon = pt.icon;
            const selected = value.paymentType === pt.id;
            return (
              <button
                key={pt.id}
                type="button"
                onClick={() => set({ paymentType: pt.id })}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  selected
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border hover:border-primary/40 hover:bg-muted/40",
                )}
              >
                <Icon className={cn("h-5 w-5 mb-2", selected ? "text-primary" : "text-muted-foreground")} />
                <div className="font-medium text-sm">{pt.title}</div>
                <div className="text-xs text-muted-foreground mt-1">{pt.description}</div>
              </button>
            );
          })}
        </div>
      </div>

      <Alert className="border-sky-500/30 bg-sky-500/5">
        <Info className="h-4 w-4 text-sky-600" />
        <AlertDescription className="text-xs">
          Please provide <strong>{typeBannerLabel(value.paymentType)}</strong> details for verification. This date will
          be reflected in the receipt printed.
        </AlertDescription>
      </Alert>

      {value.paymentType === "Cash" && (
        <div className="space-y-3 border rounded-lg p-4 bg-muted/20">
          <h4 className="text-sm font-semibold">Cash Payment Details</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>
                Paid Amount (₹) <span className="text-destructive">*</span>
              </Label>
              <Input
                value={paidAmount}
                onChange={(e) => set({ paidAmount: e.target.value })}
                placeholder="Enter amount"
                inputMode="decimal"
              />
            </div>
            <div className="space-y-1">
              <Label>
                Payment Date <span className="text-destructive">*</span>
              </Label>
              <Input
                value={value.paymentDate}
                onChange={(e) => set({ paymentDate: e.target.value })}
                placeholder="DD-MM-YYYY"
              />
            </div>
            <ReadOnlyField label="Received By" value={receivedByLabel} hint="Auto filled" />
            <ReadOnlyField label="Received At (Yard Location)" value={receivedAtLabel} hint="Auto filled" />
          </div>
          <RemarksField value={value.remarks} onChange={(remarks) => set({ remarks })} />
          <FooterNote variant="success">
            Please submit cash at the designated supervisor office and obtain receipt for your records. This date will
            be reflected in the receipt printed.
          </FooterNote>
        </div>
      )}

      {value.paymentType === "Cheque" && (
        <div className="space-y-3 border rounded-lg p-4 bg-muted/20">
          <h4 className="text-sm font-semibold">Cheque Payment Details</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>
                Cheque Number <span className="text-destructive">*</span>
              </Label>
              <Input
                value={value.chequeNo}
                onChange={(e) => set({ chequeNo: e.target.value })}
                placeholder="Enter cheque number"
              />
            </div>
            <div className="space-y-1">
              <Label>
                Cheque Date <span className="text-destructive">*</span>
              </Label>
              <Input
                value={value.chequeDate}
                onChange={(e) => set({ chequeDate: e.target.value })}
                placeholder="DD-MM-YYYY"
              />
            </div>
            <div className="space-y-1">
              <Label>
                Cheque Amount (₹) <span className="text-destructive">*</span>
              </Label>
              <Input
                value={paidAmount}
                onChange={(e) => set({ paidAmount: e.target.value })}
                placeholder="Enter amount"
                inputMode="decimal"
              />
            </div>
            <div className="space-y-1">
              <Label>
                Bank Name <span className="text-destructive">*</span>
              </Label>
              <BankSelect value={value.bankName} onChange={(bankName) => set({ bankName })} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>
                Branch Name <span className="text-destructive">*</span>
              </Label>
              <Input
                value={value.branchName}
                onChange={(e) => set({ branchName: e.target.value })}
                placeholder="Enter branch name"
              />
            </div>
            <ReadOnlyField label="Received By" value={receivedByLabel} hint="Auto filled" />
            <ReadOnlyField label="Received At (Yard Location)" value={receivedAtLabel} hint="Auto filled" />
          </div>
          <RemarksField value={value.remarks} onChange={(remarks) => set({ remarks })} optionalLabel="Remarks (Optional)" />
          <FooterNote variant="warning">
            Cheque is subject to bank clearance. Please ensure details are correct. This date will be reflected in the
            receipt printed.
          </FooterNote>
        </div>
      )}

      {value.paymentType === "NeftRtgs" && (
        <div className="space-y-3 border rounded-lg p-4 bg-muted/20">
          <h4 className="text-sm font-semibold">NEFT / RTGS Payment Details</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label>
                UTR / Transaction Reference No. <span className="text-destructive">*</span>
              </Label>
              <Input
                value={value.utr}
                onChange={(e) => set({ utr: e.target.value })}
                placeholder="Enter UTR number"
              />
            </div>
            <div className="space-y-1">
              <Label>
                Transaction Date <span className="text-destructive">*</span>
              </Label>
              <Input
                value={value.transactionDate}
                onChange={(e) => set({ transactionDate: e.target.value })}
                placeholder="DD-MM-YYYY"
              />
            </div>
            <div className="space-y-1">
              <Label>
                Bank Name <span className="text-destructive">*</span>
              </Label>
              <BankSelect value={value.bankName} onChange={(bankName) => set({ bankName })} />
            </div>
            <div className="space-y-1">
              <Label>
                Transferred Amount (₹) <span className="text-destructive">*</span>
              </Label>
              <Input
                value={paidAmount}
                onChange={(e) => set({ paidAmount: e.target.value })}
                placeholder="Enter amount"
                inputMode="decimal"
              />
            </div>
            <ReadOnlyField label="Received By" value={receivedByLabel} hint="Auto filled" />
            <ReadOnlyField label="Received At (Yard Location)" value={receivedAtLabel} hint="Auto filled" />
          </div>
          <RemarksField value={value.remarks} onChange={(remarks) => set({ remarks })} optionalLabel="Remarks (Optional)" />
          <FooterNote variant="success">
            Ensure correct UTR number is entered for successful verification. This date will be reflected in the receipt
            printed.
          </FooterNote>
        </div>
      )}
    </div>
  );
}

function ReadOnlyField({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="space-y-1">
      <Label>
        {label} <span className="text-destructive">*</span>
      </Label>
      <div className="relative">
        <Input value={value} readOnly className="bg-muted pr-9" />
        <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function BankSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const inList = (COMMON_INDIAN_BANKS as readonly string[]).includes(value);
  const selectValue = inList ? value : value ? "Other" : "";
  return (
    <div className="space-y-2">
      <Select
        value={selectValue}
        onValueChange={(v) => {
          if (v === "Other") onChange("");
          else onChange(v);
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select bank" />
        </SelectTrigger>
        <SelectContent>
          {COMMON_INDIAN_BANKS.map((b) => (
            <SelectItem key={b} value={b}>
              {b}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {(!inList || selectValue === "Other") && (
        <Input
          value={inList ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter bank name"
        />
      )}
    </div>
  );
}

function RemarksField({
  value,
  onChange,
  optionalLabel = "Payment Purpose / Remarks (Optional)",
}: {
  value: string;
  onChange: (v: string) => void;
  optionalLabel?: string;
}) {
  return (
    <div className="space-y-1">
      <Label>{optionalLabel}</Label>
      <Textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder="Enter any remarks" rows={2} />
    </div>
  );
}

function FooterNote({
  children,
  variant,
}: {
  children: ReactNode;
  variant: "success" | "warning";
}) {
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 text-xs",
        variant === "success" ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5",
      )}
    >
      {children}
    </div>
  );
}
