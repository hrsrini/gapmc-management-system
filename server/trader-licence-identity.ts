/**
 * US-M02-001: provisional licence no. (BR-AST-60), application serial APP-YYYY-NNNN,
 * public entity code ENT-YYYY-NNNNN (BR-AST-01), sequential final licence_no (BR-AST-65).
 */
import { sql } from "drizzle-orm";
import { db } from "./db";

function firstCell(r: unknown): string | number | bigint | null {
  if (r && typeof r === "object" && "rows" in r) {
    const rows = (r as { rows: Record<string, unknown>[] }).rows;
    const row = rows?.[0];
    if (!row) return null;
    const v = Object.values(row)[0];
    if (typeof v === "bigint") return v;
    if (typeof v === "number" || typeof v === "string") return v;
    return v != null ? String(v) : null;
  }
  return null;
}

/** Drizzle transaction `execute` signature varies by version; keep loose for raw SQL fragments. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function execTx(tx: any, fragment: ReturnType<typeof sql>) {
  return tx.execute(fragment);
}

/** BR-AST-60: New_<YardCode>_DD_MM_YYYY (yard code sanitized). */
export function formatProvisionalLicenceNo(yardCode: string, at: Date = new Date()): string {
  const y = at.getUTCFullYear();
  const m = String(at.getUTCMonth() + 1).padStart(2, "0");
  const d = String(at.getUTCDate()).padStart(2, "0");
  const safeYard = String(yardCode ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 16) || "YARD";
  return `New_${safeYard}_${d}_${m}_${y}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function nextNumericLicenceNoTx(tx: any): Promise<string> {
  const r = await execTx(tx, sql`SELECT nextval('gapmc.seq_trader_licence_numeric') AS n`);
  const n = firstCell(r);
  return String(n ?? "");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function nextApplicationSerialTx(tx: any): Promise<string> {
  const year = new Date().getUTCFullYear();
  const r = await execTx(
    tx,
    sql`
      INSERT INTO gapmc.m02_year_counters (scope, year, last_n)
      VALUES ('app', ${year}, 1)
      ON CONFLICT (scope, year) DO UPDATE SET last_n = gapmc.m02_year_counters.last_n + 1
      RETURNING last_n
    `,
  );
  const n = Number(firstCell(r));
  const seq = Number.isFinite(n) && n > 0 ? n : 1;
  return `APP-${year}-${String(seq).padStart(4, "0")}`;
}

/** SRS §6.1 M-02: public Entity ID `ENT-[YYYY]-[NNNNN]` (immutable once assigned). */
export const ENTITY_PUBLIC_CODE_RE = /^ENT-\d{4}-\d{5}$/;

export function formatEntityPublicCode(year: number, seq: number): string {
  return `ENT-${year}-${String(seq).padStart(5, "0")}`;
}

export function isEntityPublicCodeFormat(value: string | null | undefined): boolean {
  return ENTITY_PUBLIC_CODE_RE.test(String(value ?? "").trim());
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function nextEntityPublicCodeTx(tx: any): Promise<string> {
  const year = new Date().getUTCFullYear();
  const r = await execTx(
    tx,
    sql`
      INSERT INTO gapmc.m02_year_counters (scope, year, last_n)
      VALUES ('ent', ${year}, 1)
      ON CONFLICT (scope, year) DO UPDATE SET last_n = gapmc.m02_year_counters.last_n + 1
      RETURNING last_n
    `,
  );
  const n = Number(firstCell(r));
  const seq = Number.isFinite(n) && n > 0 ? n : 1;
  return formatEntityPublicCode(year, seq);
}

/** Allocate next ENT-YYYY-NNNNN (Track B entity master / ad-hoc entity). */
export async function nextEntityPublicCode(): Promise<string> {
  return db.transaction(async (tx: unknown) => nextEntityPublicCodeTx(tx));
}

/** Allocate final licence number + ENT public code when activating (preserves existing non-empty values). */
export async function allocateTraderLicenceActivationIds(input: {
  existingLicenceNo: string | null | undefined;
  existingEntityPublicCode: string | null | undefined;
}): Promise<{ licenceNo: string; entityPublicCode: string }> {
  const hasNo = input.existingLicenceNo != null && String(input.existingLicenceNo).trim() !== "";
  const hasEnt = input.existingEntityPublicCode != null && String(input.existingEntityPublicCode).trim() !== "";
  if (hasNo && hasEnt) {
    return {
      licenceNo: String(input.existingLicenceNo).trim(),
      entityPublicCode: String(input.existingEntityPublicCode).trim(),
    };
  }
  return await db.transaction(async (tx: unknown) => {
    const licNo = hasNo ? String(input.existingLicenceNo).trim() : await nextNumericLicenceNoTx(tx);
    const entCode = hasEnt ? String(input.existingEntityPublicCode).trim() : await nextEntityPublicCodeTx(tx);
    return { licenceNo: licNo, entityPublicCode: entCode };
  });
}
