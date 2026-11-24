import { ArrowLeft } from "lucide-react";
import { useInAppBack } from "@/hooks/useInAppBack";
import { cn } from "@/lib/utils";

type PageBackButtonProps = {
  className?: string;
};

/**
 * Standard in-app Back control — vibrant orange, top-left under the header.
 * Placed once via AppShell so every authenticated page gets the same control.
 */
export function PageBackButton({ className }: PageBackButtonProps) {
  const { goBack, canGoBack } = useInAppBack();

  return (
    <button
      type="button"
      data-testid="button-page-back"
      aria-label="Back to previous page"
      disabled={!canGoBack}
      onClick={goBack}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold text-white",
        "bg-[#F97316] hover:bg-[#EA580C] active:bg-[#C2410C]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F97316]/60 focus-visible:ring-offset-2",
        "disabled:pointer-events-none disabled:opacity-40",
        "shadow-sm",
        className,
      )}
    >
      <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
      Back
    </button>
  );
}
