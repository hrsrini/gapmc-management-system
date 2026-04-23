/**
 * M-10 / cross-cutting: data retention policy (system_config years) + read-only counts.
 * Does not delete or archive data — for compliance visibility and external archival planning (client Q50).
 */
import { and, isNotNull, sql, lte } from "drizzle-orm";
import { db, pool } from "./db";
import {
  auditLog,
  bugTickets,
  checkPostInward,
  dakInward,
  dakOutward,
  employees,
  iomsReceipts,
  landRecords,
  leaveRequests,
  paymentVouchers,
  preReceipts,
  purchaseTransactions,
  rentDepositLedger,
  rentInvoices,
  traderBlockingLog,
  traderLicences,
  users,
} from "@shared/db-schema";
import type { SystemConfigKey } from "@shared/system-config-defaults";
import { getMergedSystemConfig, parseSystemConfigNumber } from "./system-config";
import { writeAuditLogSystem } from "./audit";

const RECEIPTS_Y: SystemConfigKey = "data_retention_ioms_receipts_years";
const VOUCHERS_Y: SystemConfigKey = "data_retention_payment_vouchers_years";
const DAK_IN_Y: SystemConfigKey = "data_retention_dak_inward_years";
const DAK_OUT_Y: SystemConfigKey = "data_retention_dak_outward_years";
const AUDIT_Y: SystemConfigKey = "data_retention_audit_log_years";
const EMPLOYEES_Y: SystemConfigKey = "data_retention_employees_years";
const RENT_INV_Y: SystemConfigKey = "data_retention_rent_invoices_years";
const LAND_Y: SystemConfigKey = "data_retention_land_records_years";
const BUGS_Y: SystemConfigKey = "data_retention_bug_tickets_years";
const PURCHASE_Y: SystemConfigKey = "data_retention_purchase_transactions_years";
const CHECKPOST_Y: SystemConfigKey = "data_retention_check_post_inward_years";
const USERS_Y: SystemConfigKey = "data_retention_users_years";
const LOGIN_SESSION_Y: SystemConfigKey = "data_retention_login_session_rows_years";
const TRADER_LIC_Y: SystemConfigKey = "data_retention_trader_licences_years";
const PRE_RECEIPTS_Y: SystemConfigKey = "data_retention_pre_receipts_years";
const RENT_LEDGER_Y: SystemConfigKey = "data_retention_rent_deposit_ledger_years";
const LEAVE_REQ_Y: SystemConfigKey = "data_retention_leave_requests_years";
const TRADER_BLOCK_Y: SystemConfigKey = "data_retention_trader_blocking_log_years";

function clampYears(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > 50) return 50;
  return Math.floor(n);
}

function cutoffYmdForYears(years: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCFullYear(d.getUTCFullYear() - clampYears(years));
  return d.toISOString().slice(0, 10);
}

/** First day of month, N years ago → YYYY-MM (for rent invoice period_month). */
function cutoffYearMonthForYears(years: number): string {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCFullYear(d.getUTCFullYear() - clampYears(years));
  return d.toISOString().slice(0, 7);
}

/** UTC midnight N years ago as Unix seconds (for connect-pg-simple `expire` bigint). */
function cutoffUnixSecondsForYears(years: number): number {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCFullYear(d.getUTCFullYear() - clampYears(years));
  return Math.floor(d.getTime() / 1000);
}

async function countLoginSessionRowsPastRetention(cutoffUnix: number): Promise<{ tablePresent: boolean; count: number }> {
  const existsRes = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'session'
     ) AS exists`,
  );
  const tablePresent = Boolean(existsRes.rows[0]?.exists);
  if (!tablePresent) return { tablePresent: false, count: 0 };
  const countRes = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM public.session WHERE expire IS NOT NULL AND expire <= $1`,
    [cutoffUnix],
  );
  return { tablePresent: true, count: parseInt(countRes.rows[0]?.n ?? "0", 10) };
}

export type DataRetentionSummary = {
  asOf: string;
  note: string;
  /** When false, express-session uses in-memory store (typical dev); `expressLoginSessions` count is always 0. */
  loginSessionTablePresent: boolean;
  policyYears: Record<string, number>;
  cutoffDates: Record<string, string>;
  countsPastRetention: Record<string, number>;
};

export async function getDataRetentionSummary(): Promise<DataRetentionSummary> {
  const cfg = await getMergedSystemConfig();
  const yReceipts = clampYears(parseSystemConfigNumber(cfg, RECEIPTS_Y));
  const yVouchers = clampYears(parseSystemConfigNumber(cfg, VOUCHERS_Y));
  const yDakIn = clampYears(parseSystemConfigNumber(cfg, DAK_IN_Y));
  const yDakOut = clampYears(parseSystemConfigNumber(cfg, DAK_OUT_Y));
  const yAudit = clampYears(parseSystemConfigNumber(cfg, AUDIT_Y));
  const yEmp = clampYears(parseSystemConfigNumber(cfg, EMPLOYEES_Y));
  const yRentInv = clampYears(parseSystemConfigNumber(cfg, RENT_INV_Y));
  const yLand = clampYears(parseSystemConfigNumber(cfg, LAND_Y));
  const yBugs = clampYears(parseSystemConfigNumber(cfg, BUGS_Y));
  const yPurch = clampYears(parseSystemConfigNumber(cfg, PURCHASE_Y));
  const yCp = clampYears(parseSystemConfigNumber(cfg, CHECKPOST_Y));
  const yUsers = clampYears(parseSystemConfigNumber(cfg, USERS_Y));
  const yLoginSess = clampYears(parseSystemConfigNumber(cfg, LOGIN_SESSION_Y));
  const yTraderLic = clampYears(parseSystemConfigNumber(cfg, TRADER_LIC_Y));
  const yPreRcpt = clampYears(parseSystemConfigNumber(cfg, PRE_RECEIPTS_Y));
  const yRentLed = clampYears(parseSystemConfigNumber(cfg, RENT_LEDGER_Y));
  const yLeaveReq = clampYears(parseSystemConfigNumber(cfg, LEAVE_REQ_Y));
  const yTraderBlock = clampYears(parseSystemConfigNumber(cfg, TRADER_BLOCK_Y));

  const cutR = cutoffYmdForYears(yReceipts);
  const cutV = cutoffYmdForYears(yVouchers);
  const cutDi = cutoffYmdForYears(yDakIn);
  const cutDo = cutoffYmdForYears(yDakOut);
  const cutAudit = cutoffYmdForYears(yAudit);
  const cutEmp = cutoffYmdForYears(yEmp);
  const cutRentYm = cutoffYearMonthForYears(yRentInv);
  const cutLand = cutoffYmdForYears(yLand);
  const cutBugs = cutoffYmdForYears(yBugs);
  const cutPurch = cutoffYmdForYears(yPurch);
  const cutCp = cutoffYmdForYears(yCp);
  const cutUsers = cutoffYmdForYears(yUsers);
  const cutLoginSessUnix = cutoffUnixSecondsForYears(yLoginSess);
  const cutLoginSessYmd = new Date(cutLoginSessUnix * 1000).toISOString().slice(0, 10);
  const cutTraderLic = cutoffYmdForYears(yTraderLic);
  const cutPreRcpt = cutoffYmdForYears(yPreRcpt);
  const cutRentLed = cutoffYmdForYears(yRentLed);
  const cutLeaveReq = cutoffYmdForYears(yLeaveReq);
  const cutTraderBlock = cutoffYmdForYears(yTraderBlock);

  const [rR] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(iomsReceipts)
    .where(sql`left(${iomsReceipts.createdAt}, 10) <= ${cutR}`);
  const [rV] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(paymentVouchers)
    .where(and(isNotNull(paymentVouchers.createdAt), sql`left(${paymentVouchers.createdAt}, 10) <= ${cutV}`));
  const [rDi] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(dakInward)
    .where(and(isNotNull(dakInward.createdAt), sql`left(${dakInward.createdAt}, 10) <= ${cutDi}`));
  const [rDo] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(dakOutward)
    .where(and(isNotNull(dakOutward.createdAt), sql`left(${dakOutward.createdAt}, 10) <= ${cutDo}`));
  const [rAudit] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(sql`left(${auditLog.createdAt}, 10) <= ${cutAudit}`);
  const [rEmp] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(employees)
    .where(and(isNotNull(employees.createdAt), sql`left(${employees.createdAt}, 10) <= ${cutEmp}`));
  const [rRent] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(rentInvoices)
    .where(lte(rentInvoices.periodMonth, cutRentYm));
  const [rLand] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(landRecords)
    .where(sql`left(${landRecords.createdAt}, 10) <= ${cutLand}`);
  const [rBugs] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(bugTickets)
    .where(sql`left(${bugTickets.createdAt}, 10) <= ${cutBugs}`);
  const [rPurch] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(purchaseTransactions)
    .where(sql`left(${purchaseTransactions.transactionDate}, 10) <= ${cutPurch}`);
  const [rCp] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(checkPostInward)
    .where(sql`left(${checkPostInward.entryDate}, 10) <= ${cutCp}`);
  const [rUsers] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(users)
    .where(and(isNotNull(users.createdAt), sql`left(${users.createdAt}, 10) <= ${cutUsers}`));

  const [rTraderLic] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(traderLicences)
    .where(and(isNotNull(traderLicences.createdAt), sql`left(${traderLicences.createdAt}, 10) <= ${cutTraderLic}`));
  const [rPreRcpt] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(preReceipts)
    .where(
      sql`coalesce(left(${preReceipts.issuedAt}, 10), left(${preReceipts.updatedAt}, 10)) is not null AND coalesce(left(${preReceipts.issuedAt}, 10), left(${preReceipts.updatedAt}, 10)) <= ${cutPreRcpt}`,
    );
  const [rRentLed] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(rentDepositLedger)
    .where(sql`left(${rentDepositLedger.entryDate}, 10) <= ${cutRentLed}`);
  const [rLeaveReq] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(leaveRequests)
    .where(sql`left(${leaveRequests.fromDate}, 10) <= ${cutLeaveReq}`);
  const [rTraderBlock] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(traderBlockingLog)
    .where(sql`left(${traderBlockingLog.actionedAt}, 10) <= ${cutTraderBlock}`);

  const { tablePresent: loginSessionTablePresent, count: loginSessionPast } = await countLoginSessionRowsPastRetention(
    cutLoginSessUnix,
  );

  const asOf = new Date().toISOString();
  return {
    asOf,
    note:
      "Read-only snapshot: most entities use created_at vs cutoff; M-04 purchase uses transaction_date; check_post_inward uses entry_date; rent invoices use period_month (YYYY-MM) vs cutoff month; users with null created_at are excluded from the users count; express login sessions use public.session.expire (unix) vs cutoff when that table exists; pre_receipts use coalesce(issued_at, updated_at); leave_requests use from_date; rent_deposit_ledger uses entry_date; trader_blocking_log uses actioned_at. No deletes.",
    loginSessionTablePresent,
    policyYears: {
      iomsReceipts: yReceipts,
      paymentVouchers: yVouchers,
      dakInward: yDakIn,
      dakOutward: yDakOut,
      auditLog: yAudit,
      employees: yEmp,
      rentInvoices: yRentInv,
      landRecords: yLand,
      bugTickets: yBugs,
      purchaseTransactions: yPurch,
      checkPostInward: yCp,
      users: yUsers,
      expressLoginSessions: yLoginSess,
      traderLicences: yTraderLic,
      preReceipts: yPreRcpt,
      rentDepositLedger: yRentLed,
      leaveRequests: yLeaveReq,
      traderBlockingLog: yTraderBlock,
    },
    cutoffDates: {
      iomsReceipts: cutR,
      paymentVouchers: cutV,
      dakInward: cutDi,
      dakOutward: cutDo,
      auditLog: cutAudit,
      employees: cutEmp,
      rentInvoices: cutRentYm,
      landRecords: cutLand,
      bugTickets: cutBugs,
      purchaseTransactions: cutPurch,
      checkPostInward: cutCp,
      users: cutUsers,
      expressLoginSessions: cutLoginSessYmd,
      traderLicences: cutTraderLic,
      preReceipts: cutPreRcpt,
      rentDepositLedger: cutRentLed,
      leaveRequests: cutLeaveReq,
      traderBlockingLog: cutTraderBlock,
    },
    countsPastRetention: {
      iomsReceipts: Number(rR?.c ?? 0),
      paymentVouchers: Number(rV?.c ?? 0),
      dakInward: Number(rDi?.c ?? 0),
      dakOutward: Number(rDo?.c ?? 0),
      auditLog: Number(rAudit?.c ?? 0),
      employees: Number(rEmp?.c ?? 0),
      rentInvoices: Number(rRent?.c ?? 0),
      landRecords: Number(rLand?.c ?? 0),
      bugTickets: Number(rBugs?.c ?? 0),
      purchaseTransactions: Number(rPurch?.c ?? 0),
      checkPostInward: Number(rCp?.c ?? 0),
      users: Number(rUsers?.c ?? 0),
      expressLoginSessions: loginSessionPast,
      traderLicences: Number(rTraderLic?.c ?? 0),
      preReceipts: Number(rPreRcpt?.c ?? 0),
      rentDepositLedger: Number(rRentLed?.c ?? 0),
      leaveRequests: Number(rLeaveReq?.c ?? 0),
      traderBlockingLog: Number(rTraderBlock?.c ?? 0),
    },
  };
}

/** Cron / HTTP: persist summary to audit_log (system actor). */
export async function runDataRetentionAuditJob(opts?: { ip?: string | null }): Promise<DataRetentionSummary> {
  const summary = await getDataRetentionSummary();
  await writeAuditLogSystem(
    {
      module: "M-10",
      action: "DataRetentionAudit",
      recordId: "data_retention",
      afterValue: summary,
    },
    opts,
  );
  return summary;
}
