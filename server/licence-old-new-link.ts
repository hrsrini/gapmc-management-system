/**
 * Old/New License Number Management — link LM-replaced licences in App 2.
 * New licence.linkedOldLicenceId ↔ Old licence.supersededByLicenceId
 */
import { eq, sql } from "drizzle-orm";
import { traderLicences, yards } from "@shared/db-schema";
import { db, pool } from "./db";

/** Normalize licence numbers for matching (spaces, case). */
export function normalizeLicenceNoKey(raw: string | null | undefined): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

/** Base key without class suffix (9871/A → 9871). */
export function licenceNoBaseKey(raw: string | null | undefined): string {
  const n = normalizeLicenceNoKey(raw);
  const slash = n.indexOf("/");
  return slash > 0 ? n.slice(0, slash) : n;
}

export type LinkedOldLicenceSummary = {
  id: string;
  licenceNo: string | null;
  validTo: string | null;
  yardId: string;
  yardName: string | null;
  status: string | null;
};

async function applicationsTableExists(): Promise<boolean> {
  const r = await pool.query<{ exists: boolean }>(
    `SELECT to_regclass('public.applications') IS NOT NULL AS exists`,
  );
  return Boolean(r.rows[0]?.exists);
}

/**
 * Find a trader_licences row by LM licence number (exact or unique base match).
 */
export async function findTraderLicenceByLicenceNoFlexible(
  licenceNo: string,
): Promise<{ id: string; licenceNo: string | null } | null> {
  const key = normalizeLicenceNoKey(licenceNo);
  if (!key) return null;

  const exact = await db
    .select({ id: traderLicences.id, licenceNo: traderLicences.licenceNo })
    .from(traderLicences)
    .where(sql`upper(replace(coalesce(${traderLicences.licenceNo}, ''), ' ', '')) = ${key}`)
    .limit(2);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    // Prefer exact display match
    const hit = exact.find((r) => normalizeLicenceNoKey(r.licenceNo) === key);
    return hit ?? exact[0];
  }

  const base = licenceNoBaseKey(licenceNo);
  if (!base || base === key) return null;

  const byBase = await db
    .select({ id: traderLicences.id, licenceNo: traderLicences.licenceNo })
    .from(traderLicences)
    .where(
      sql`upper(split_part(replace(coalesce(${traderLicences.licenceNo}, ''), ' ', ''), '/', 1)) = ${base}`,
    )
    .limit(5);
  if (byBase.length === 1) return byBase[0];
  // Prefer Active when multiple, else first
  if (byBase.length > 1) {
    const withStatus = await db
      .select({
        id: traderLicences.id,
        licenceNo: traderLicences.licenceNo,
        status: traderLicences.status,
      })
      .from(traderLicences)
      .where(
        sql`upper(split_part(replace(coalesce(${traderLicences.licenceNo}, ''), ' ', ''), '/', 1)) = ${base}`,
      )
      .limit(10);
    const active = withStatus.find((r) => String(r.status) === "Active");
    return active ?? withStatus[0] ?? null;
  }
  return null;
}

/** Persist bidirectional old↔new link (idempotent). */
export async function linkOldAndNewLicences(args: {
  newLicenceId: string;
  oldLicenceId: string;
}): Promise<boolean> {
  const { newLicenceId, oldLicenceId } = args;
  if (!newLicenceId || !oldLicenceId || newLicenceId === oldLicenceId) return false;

  const [neu] = await db.select().from(traderLicences).where(eq(traderLicences.id, newLicenceId)).limit(1);
  const [old] = await db.select().from(traderLicences).where(eq(traderLicences.id, oldLicenceId)).limit(1);
  if (!neu || !old) return false;

  const already =
    String(neu.linkedOldLicenceId ?? "") === oldLicenceId &&
    String(old.supersededByLicenceId ?? "") === newLicenceId;
  if (already) return false;

  const now = new Date().toISOString();
  await db
    .update(traderLicences)
    .set({ linkedOldLicenceId: oldLicenceId, updatedAt: now })
    .where(eq(traderLicences.id, newLicenceId));
  await db
    .update(traderLicences)
    .set({ supersededByLicenceId: newLicenceId, updatedAt: now })
    .where(eq(traderLicences.id, oldLicenceId));
  return true;
}

type LmLinkHints = {
  originalLicenseNumber: string | null;
  supersededByLicenseNumber: string | null;
};

async function renewalsTableExists(): Promise<boolean> {
  const r = await pool.query<{ exists: boolean }>(
    `SELECT to_regclass('public.renewals') IS NOT NULL AS exists`,
  );
  return Boolean(r.rows[0]?.exists);
}

async function fetchLmLinkHints(licenceNo: string): Promise<LmLinkHints | null> {
  const no = licenceNo.trim();
  if (!no) return null;

  let originalLicenseNumber: string | null = null;
  let supersededByLicenseNumber: string | null = null;

  if (await applicationsTableExists()) {
    const r = await pool.query<{
      original_license_number: string | null;
      superseded_by_license_number: string | null;
    }>(
      `
      SELECT original_license_number, superseded_by_license_number
      FROM public.applications
      WHERE license_number = $1
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 1
      `,
      [no],
    );
    const row = r.rows[0];
    if (row) {
      originalLicenseNumber = row.original_license_number?.trim() || null;
      supersededByLicenseNumber = row.superseded_by_license_number?.trim() || null;
    }
  }

  // Secondary: LM renewals (new_license_number ↔ original_license_number).
  if ((!originalLicenseNumber || !supersededByLicenseNumber) && (await renewalsTableExists())) {
    if (!originalLicenseNumber) {
      const asNew = await pool.query<{ original_license_number: string | null }>(
        `
        SELECT original_license_number
        FROM public.renewals
        WHERE new_license_number = $1
          AND original_license_number IS NOT NULL
          AND trim(original_license_number) <> ''
          AND upper(replace(trim(original_license_number), ' ', ''))
            <> upper(replace(trim($1), ' ', ''))
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 1
        `,
        [no],
      );
      originalLicenseNumber = asNew.rows[0]?.original_license_number?.trim() || null;
    }
    if (!supersededByLicenseNumber) {
      const asOld = await pool.query<{ new_license_number: string | null }>(
        `
        SELECT new_license_number
        FROM public.renewals
        WHERE original_license_number = $1
          AND new_license_number IS NOT NULL
          AND trim(new_license_number) <> ''
          AND upper(replace(trim(new_license_number), ' ', ''))
            <> upper(replace(trim($1), ' ', ''))
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 1
        `,
        [no],
      );
      supersededByLicenseNumber = asOld.rows[0]?.new_license_number?.trim() || null;
    }
  }

  if (!originalLicenseNumber && !supersededByLicenseNumber) return null;
  return { originalLicenseNumber, supersededByLicenseNumber };
}

/**
 * Reconcile link for one IOMS licence using LM applications data.
 * Returns whether a link was written.
 */
export async function reconcileLicenceOldNewLinkForLicenceId(licenceId: string): Promise<boolean> {
  const [lic] = await db.select().from(traderLicences).where(eq(traderLicences.id, licenceId)).limit(1);
  if (!lic?.licenceNo) return false;

  // Already linked as new
  if (lic.linkedOldLicenceId) {
    const [old] = await db
      .select()
      .from(traderLicences)
      .where(eq(traderLicences.id, lic.linkedOldLicenceId))
      .limit(1);
    if (old && String(old.supersededByLicenceId ?? "") !== licenceId) {
      await linkOldAndNewLicences({ newLicenceId: licenceId, oldLicenceId: old.id });
      return true;
    }
    return false;
  }

  // Already superseded as old
  if (lic.supersededByLicenceId) return false;

  const hints = await fetchLmLinkHints(lic.licenceNo);
  if (!hints) return false;

  // This row is the NEW licence (has original / previous number)
  if (hints.originalLicenseNumber) {
    const old = await findTraderLicenceByLicenceNoFlexible(hints.originalLicenseNumber);
    if (old && old.id !== licenceId) {
      return linkOldAndNewLicences({ newLicenceId: licenceId, oldLicenceId: old.id });
    }
  }

  // This row is the OLD licence (superseded_by points at new number)
  if (hints.supersededByLicenseNumber) {
    const neu = await findTraderLicenceByLicenceNoFlexible(hints.supersededByLicenseNumber);
    if (neu && neu.id !== licenceId) {
      return linkOldAndNewLicences({ newLicenceId: neu.id, oldLicenceId: licenceId });
    }
  }

  return false;
}

export async function getLinkedOldLicenceSummary(
  newLicenceId: string,
): Promise<LinkedOldLicenceSummary | null> {
  const [neu] = await db
    .select({ linkedOldLicenceId: traderLicences.linkedOldLicenceId })
    .from(traderLicences)
    .where(eq(traderLicences.id, newLicenceId))
    .limit(1);
  const oldId = neu?.linkedOldLicenceId;
  if (!oldId) return null;

  const rows = await db
    .select({
      id: traderLicences.id,
      licenceNo: traderLicences.licenceNo,
      validTo: traderLicences.validTo,
      yardId: traderLicences.yardId,
      status: traderLicences.status,
      yardName: yards.name,
    })
    .from(traderLicences)
    .leftJoin(yards, eq(yards.id, traderLicences.yardId))
    .where(eq(traderLicences.id, oldId))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    licenceNo: r.licenceNo,
    validTo: r.validTo,
    yardId: r.yardId,
    yardName: r.yardName ?? null,
    status: r.status,
  };
}

export async function getSupersedingLicenceSummary(
  oldLicenceId: string,
): Promise<{ id: string; licenceNo: string | null } | null> {
  const [old] = await db
    .select({ supersededByLicenceId: traderLicences.supersededByLicenceId })
    .from(traderLicences)
    .where(eq(traderLicences.id, oldLicenceId))
    .limit(1);
  const newId = old?.supersededByLicenceId;
  if (!newId) return null;
  const [neu] = await db
    .select({ id: traderLicences.id, licenceNo: traderLicences.licenceNo })
    .from(traderLicences)
    .where(eq(traderLicences.id, newId))
    .limit(1);
  return neu ?? null;
}

/** Format payment/dues label: `10282 (9871/A)` when origin differs. */
export function formatLicenceWithLinkedOldBracket(
  currentLicenceNo: string | null | undefined,
  originLicenceNo: string | null | undefined,
): string {
  const cur = String(currentLicenceNo ?? "").trim();
  const origin = String(originLicenceNo ?? "").trim();
  if (!cur) return origin || "—";
  if (!origin || normalizeLicenceNoKey(origin) === normalizeLicenceNoKey(cur)) return cur;
  return `${cur} (${origin})`;
}

/**
 * Backfill links from LM applications + renewals that encode old→new numbers.
 */
export async function backfillLicenceOldNewLinks(): Promise<{ linked: number; scanned: number }> {
  const numbers = new Set<string>();

  if (await applicationsTableExists()) {
    const apps = await pool.query<{ license_number: string | null }>(
      `
      SELECT DISTINCT ON (license_number) license_number
      FROM public.applications
      WHERE license_number IS NOT NULL AND trim(license_number) <> ''
        AND (
          (original_license_number IS NOT NULL AND trim(original_license_number) <> '')
          OR (superseded_by_license_number IS NOT NULL AND trim(superseded_by_license_number) <> '')
        )
      ORDER BY license_number, updated_at DESC NULLS LAST
      `,
    );
    for (const a of apps.rows) {
      const no = a.license_number?.trim();
      if (no) numbers.add(no);
    }
  }

  if (await renewalsTableExists()) {
    const renew = await pool.query<{
      original_license_number: string | null;
      new_license_number: string | null;
    }>(
      `
      SELECT original_license_number, new_license_number
      FROM public.renewals
      WHERE original_license_number IS NOT NULL AND trim(original_license_number) <> ''
        AND new_license_number IS NOT NULL AND trim(new_license_number) <> ''
        AND upper(replace(trim(original_license_number), ' ', ''))
          <> upper(replace(trim(new_license_number), ' ', ''))
      `,
    );
    for (const row of renew.rows) {
      const neu = row.new_license_number?.trim();
      const old = row.original_license_number?.trim();
      if (neu) numbers.add(neu);
      if (old) numbers.add(old);
    }
  }

  let linked = 0;
  let scanned = 0;
  for (const no of numbers) {
    scanned += 1;
    const ioms = await findTraderLicenceByLicenceNoFlexible(no);
    if (!ioms) continue;
    const changed = await reconcileLicenceOldNewLinkForLicenceId(ioms.id);
    if (changed) linked += 1;
  }
  return { linked, scanned };
}
