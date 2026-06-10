import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** Transitions that require explicit user confirmation before applying. */
export function tenancyStatusChangeNeedsConfirm(currentStatus: string, nextStatus: string): boolean {
  const cur = String(currentStatus ?? "").trim();
  const next = String(nextStatus ?? "").trim();
  if (cur === next) return false;
  return (
    (cur === "Active" && (next === "Vacating" || next === "Vacated")) ||
    (cur === "Vacating" && next === "Vacated")
  );
}

export function tenancyVacateConfirmMessage(allotteeName: string, premisesName: string): string {
  const occupant = allotteeName.trim() || "the occupant";
  const premises = premisesName.trim() || "the premises";
  return `Are you sure that ${occupant} is Vacating ${premises}?`;
}

export function TenancyVacateConfirmDialog({
  open,
  onOpenChange,
  allotteeName,
  premisesName,
  onConfirm,
  loading = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allotteeName: string;
  premisesName: string;
  onConfirm: () => void;
  loading?: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm tenancy status change</AlertDialogTitle>
          <AlertDialogDescription>{tenancyVacateConfirmMessage(allotteeName, premisesName)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>No</AlertDialogCancel>
          <AlertDialogAction
            disabled={loading}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            Yes
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
