import { useId, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { normalizePanInput, panFirstMismatchIndex, isValidPanFormat } from "@shared/india-validation";
import type { PanCheckExcludes } from "@/lib/panUniqueness";
import { checkPanUniqueness as checkPanUniquenessApi } from "@/lib/panUniqueness";

type PanUniqState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available" }
  | { state: "taken"; message: string }
  | { state: "error"; message: string };

const PAN_REGEX_DISPLAY = "[A-Z]{5}[0-9]{4}[A-Z]{1}";

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
  /** When set, passed to the default blur uniqueness check (editing an existing master row). */
  uniquenessExcludes?: PanCheckExcludes;
  /** When true (default), show H.2.2 policy hint block under the field. */
  showPolicyHints?: boolean;
}) {
  const hintUid = useId();
  const hintBlockId = props.id ? `${props.id}-pan-hints` : `pan-hints-${hintUid}`;
  const [uniq, setUniq] = useState<PanUniqState>({ state: "idle" });
  const showPolicy = props.showPolicyHints !== false;

  const normalized = useMemo(() => normalizePanInput(props.value), [props.value]);
  const mismatch = useMemo(() => panFirstMismatchIndex(normalized), [normalized]);
  const isValid = useMemo(() => isValidPanFormat(normalized), [normalized]);

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
    const pan = normalizePanInput(props.value);
    if (!isValidPanFormat(pan)) return;

    setUniq({ state: "checking" });
    try {
      const r = props.onBlurCheckUniqueness
        ? await props.onBlurCheckUniqueness(pan)
        : await checkPanUniquenessApi(pan, props.uniquenessExcludes);
      if (!r.ok) {
        setUniq({ state: "taken", message: r.message ?? "PAN is already in use." });
      } else {
        setUniq({ state: "available" });
      }
    } catch (e) {
      setUniq({ state: "error", message: e instanceof Error ? e.message : "Failed to check PAN uniqueness." });
    }
  }

  const inputId = props.id;

  return (
    <div className="space-y-1">
      <Input
        id={inputId}
        aria-describedby={showPolicy ? hintBlockId : undefined}
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

      {showPolicy ? (
        <div id={hintBlockId} className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Max. 10 characters.</span> Entry is converted to uppercase.
            Format <span className="font-mono text-foreground">ABCDE1234F</span> (pattern{" "}
            <span className="font-mono break-all">{PAN_REGEX_DISPLAY}</span>).
          </p>
          <p>
            {props.required ? (
              <span className="font-medium text-foreground">Mandatory on this form.</span>
            ) : (
              <span>Optional unless your workflow requires it.</span>
            )}{" "}
            Must be unique across active employees, entities, trader licences, and active or pending legacy traders;
            uniqueness is checked on this field&apos;s blur (not only on save).
          </p>
          <p>Full PAN is not included in staff-list CSV exports — a masked value is emitted instead (H.2.2).</p>
          {normalized.length > 0 && mismatch != null ? (
            <div className="flex flex-wrap items-center gap-2 text-foreground">
              {patternLine}
              <span className="text-destructive font-medium">Invalid at position {mismatch + 1}</span>
            </div>
          ) : null}
          {uniq.state === "checking" ? <p className="text-muted-foreground">Checking uniqueness…</p> : null}
          {uniq.state === "taken" ? <p className="text-destructive">{uniq.message}</p> : null}
          {uniq.state === "error" ? <p className="text-destructive">{uniq.message}</p> : null}
          {uniq.state === "available" ? (
            <p className="text-emerald-700 dark:text-emerald-400">PAN is available.</p>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
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
      )}
    </div>
  );
}
