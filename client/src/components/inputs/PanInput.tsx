import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { normalizePanInput, panFirstMismatchIndex, isValidPanFormat } from "@shared/india-validation";

type PanUniqState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available" }
  | { state: "taken"; message: string }
  | { state: "error"; message: string };

export function PanInput(props: {
  id?: string;
  label?: string;
  value: string;
  onChange: (next: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** If provided, called on blur when PAN is valid to check server-side uniqueness. */
  onBlurCheckUniqueness?: (pan: string) => Promise<{ ok: boolean; message?: string }>;
}) {
  const [uniq, setUniq] = useState<PanUniqState>({ state: "idle" });

  const normalized = useMemo(() => normalizePanInput(props.value), [props.value]);
  const mismatch = useMemo(() => panFirstMismatchIndex(normalized), [normalized]);
  const isValid = useMemo(() => isValidPanFormat(normalized), [normalized]);

  const hint = "Format: ABCDE1234F";
  const template = "AAAAA9999A";

  const patternLine = useMemo(() => {
    const bad = mismatch;
    return (
      <span className="font-mono text-xs text-muted-foreground tracking-wider select-none">
        {template.split("").map((t, i) => (
          <span
            key={i}
            className={cn(
              "inline-block w-[0.75rem] text-center",
              bad === i ? "text-destructive underline decoration-destructive decoration-2" : "",
            )}
          >
            {t}
          </span>
        ))}
      </span>
    );
  }, [mismatch]);

  async function handleBlur() {
    if (!props.onBlurCheckUniqueness) return;
    const pan = normalizePanInput(props.value);
    if (!isValidPanFormat(pan)) return;

    setUniq({ state: "checking" });
    try {
      const r = await props.onBlurCheckUniqueness(pan);
      if (!r.ok) {
        setUniq({ state: "taken", message: r.message ?? "PAN is already in use." });
      } else {
        setUniq({ state: "available" });
      }
    } catch (e) {
      setUniq({ state: "error", message: e instanceof Error ? e.message : "Failed to check PAN uniqueness." });
    }
  }

  return (
    <div className="space-y-1">
      <Input
        id={props.id}
        value={normalized}
        onChange={(e) => {
          setUniq({ state: "idle" });
          props.onChange(normalizePanInput(e.target.value));
        }}
        onBlur={handleBlur}
        placeholder={props.placeholder ?? "ABCDE1234F"}
        required={props.required}
        disabled={props.disabled}
        inputMode="text"
        maxLength={10}
        autoComplete="off"
        className={cn(
          mismatch != null || (normalized.length === 10 && !isValid) || uniq.state === "taken"
            ? "border-destructive focus-visible:ring-destructive"
            : "",
        )}
      />

      <div className="flex flex-col gap-1">
        <p className="text-xs text-muted-foreground">
          {hint} (regex: <span className="font-mono">[A-Z]&#123;5&#125;[0-9]&#123;4&#125;[A-Z]</span>)
        </p>
        {normalized.length > 0 && mismatch != null ? (
          <div className="flex items-center gap-2">
            {patternLine}
            <span className="text-xs text-destructive">Invalid at position {mismatch + 1}</span>
          </div>
        ) : null}
        {uniq.state === "checking" ? (
          <p className="text-xs text-muted-foreground">Checking uniqueness…</p>
        ) : uniq.state === "taken" ? (
          <p className="text-xs text-destructive">{uniq.message}</p>
        ) : uniq.state === "error" ? (
          <p className="text-xs text-destructive">{uniq.message}</p>
        ) : uniq.state === "available" ? (
          <p className="text-xs text-emerald-700 dark:text-emerald-400">PAN is available.</p>
        ) : null}
      </div>
    </div>
  );
}

