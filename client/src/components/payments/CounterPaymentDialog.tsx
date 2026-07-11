import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import { useScopedActiveYards } from "@/hooks/useScopedActiveYards";
import { PaymentPreferenceForm } from "@/components/payments/PaymentPreferenceForm";
import {
  buildCounterDuesPaymentApiBody,
  defaultPaymentPreferenceValue,
  validatePaymentPreference,
  type PaymentPreferenceValue,
} from "@/lib/duesCounterPayment";
import { useToast } from "@/hooks/use-toast";

export interface CounterPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  yardId: string;
  summaryContent: ReactNode;
  amount: string;
  onAmountChange: (value: string) => void;
  amountLabel?: string;
  onConfirm: (payBody: Record<string, unknown>) => Promise<void>;
  confirmPending?: boolean;
  showPayOnline?: boolean;
  onPayOnline?: () => void;
  payOnlinePending?: boolean;
  canAdvanceFromSummary?: boolean;
  /** When dialog opens, start on summary or payment-mode step. */
  initialStep?: "summary" | "payment";
  /** Hide amount field on summary (caller already collected amount). */
  hideAmountOnSummary?: boolean;
}

export function CounterPaymentDialog({
  open,
  onOpenChange,
  title,
  yardId,
  summaryContent,
  amount,
  onAmountChange,
  amountLabel = "Amount",
  onConfirm,
  confirmPending = false,
  showPayOnline = false,
  onPayOnline,
  payOnlinePending = false,
  canAdvanceFromSummary = true,
  initialStep = "summary",
  hideAmountOnSummary = false,
}: CounterPaymentDialogProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: yards = [] } = useScopedActiveYards();
  const [payStep, setPayStep] = useState<"summary" | "payment">(initialStep);
  const [paymentPref, setPaymentPref] = useState<PaymentPreferenceValue>(() => defaultPaymentPreferenceValue());

  const receivedByLabel = user?.name ? `${user.name} (Logged in user)` : "Logged in user";
  const receivedAtLabel = useMemo(() => {
    if (!yardId) return "—";
    return yards.find((y) => y.id === yardId)?.name ?? yardId;
  }, [yardId, yards]);

  useEffect(() => {
    if (!open) {
      setPayStep(initialStep);
      setPaymentPref(defaultPaymentPreferenceValue());
      return;
    }
    setPayStep(initialStep);
    const amt = Number(amount);
    setPaymentPref(defaultPaymentPreferenceValue(Number.isFinite(amt) && amt > 0 ? amt : undefined));
  }, [open, initialStep, amount]);

  const handleClose = (next: boolean) => {
    if (!next) setPayStep(initialStep);
    onOpenChange(next);
  };

  const handleConfirm = async () => {
    const pref = { ...paymentPref, paidAmount: paymentPref.paidAmount || amount };
    const prefErr = validatePaymentPreference(pref);
    if (prefErr) {
      toast({ title: "Payment details", description: prefErr, variant: "destructive" });
      return;
    }
    const amt = Number(pref.paidAmount || amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast({ title: "Invalid amount", description: "Enter a valid amount.", variant: "destructive" });
      return;
    }
    const payBody = buildCounterDuesPaymentApiBody(pref, amt);
    await onConfirm(payBody);
    setPayStep(initialStep);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={payStep === "payment" ? "sm:max-w-2xl max-h-[90vh]" : "sm:max-w-md"}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {payStep === "summary" ? (
          <div className="space-y-3">
            {summaryContent}
            {!hideAmountOnSummary ? (
              <div className="space-y-1">
                <Label>{amountLabel}</Label>
                <Input value={amount} onChange={(e) => onAmountChange(e.target.value)} placeholder="e.g. 11800" />
              </div>
            ) : null}
          </div>
        ) : (
          <PaymentPreferenceForm
            value={paymentPref}
            onChange={setPaymentPref}
            receivedByLabel={receivedByLabel}
            receivedAtLabel={receivedAtLabel}
            summaryAmount={amount}
          />
        )}
        <DialogFooter className="flex-wrap gap-2">
          {payStep === "payment" && initialStep !== "payment" ? (
            <Button
              variant="outline"
              onClick={() => {
                setPayStep("summary");
                setPaymentPref((p) => ({ ...p, paidAmount: amount }));
              }}
            >
              Back
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => handleClose(false)}>
            Cancel
          </Button>
          {payStep === "summary" ? (
            <>
              {showPayOnline && onPayOnline ? (
                <Button
                  variant="secondary"
                  onClick={onPayOnline}
                  disabled={payOnlinePending || !canAdvanceFromSummary}
                >
                  Pay online
                </Button>
              ) : null}
              <Button
                onClick={() => {
                  const amt = Number(amount);
                  if (!Number.isFinite(amt) || amt <= 0) {
                    toast({ title: "Invalid amount", description: "Enter a valid amount.", variant: "destructive" });
                    return;
                  }
                  if (!canAdvanceFromSummary) return;
                  setPaymentPref(defaultPaymentPreferenceValue(amt));
                  setPayStep("payment");
                }}
                disabled={!canAdvanceFromSummary}
              >
                Pay
              </Button>
            </>
          ) : (
            <Button onClick={() => void handleConfirm()} disabled={confirmPending}>
              {confirmPending ? "Saving…" : "Confirm payment"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
