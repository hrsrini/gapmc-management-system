import { randomUUID } from "crypto";
import { eq, count, desc } from "drizzle-orm";
import { db } from "./db";
import {
  traders as tradersTable,
  invoices as invoicesTable,
  receipts as receiptsTable,
  marketFees as marketFeesTable,
  agreements as agreementsTable,
  stockReturns as stockReturnsTable,
  activityLogs as activityLogsTable,
} from "@shared/db-schema";
import type {
  Trader,
  InsertTrader,
  Invoice,
  InsertInvoice,
  Receipt,
  InsertReceipt,
  MarketFee,
  InsertMarketFee,
  Agreement,
  InsertAgreement,
  StockReturn,
  InsertStockReturn,
  ActivityLog,
} from "@shared/schema";
import type { IStorage } from "./storage";

function now() {
  return new Date().toISOString();
}

/** Map DB row (snake_case or camelCase) to StockReturn (camelCase) so opening_balance etc. are always returned correctly */
function mapStockReturnRow(row: Record<string, unknown>): StockReturn {
  return {
    id: String(row.id),
    traderId: String(row.traderId ?? row.trader_id),
    traderName: String(row.traderName ?? row.trader_name),
    period: String(row.period ?? row.period),
    commodity: String(row.commodity ?? row.commodity),
    openingBalance: Number(row.openingBalance ?? row.opening_balance ?? 0),
    locallyProcured: Number(row.locallyProcured ?? row.locally_procured ?? 0),
    purchasedFromTrader: Number(row.purchasedFromTrader ?? row.purchased_from_trader ?? 0),
    sales: Number(row.sales ?? row.sales ?? 0),
    closingBalance: Number(row.closingBalance ?? row.closing_balance ?? 0),
    status: String(row.status ?? row.status) as StockReturn["status"],
    createdAt: row.createdAt != null ? String(row.createdAt) : row.created_at != null ? String(row.created_at) : undefined,
    updatedAt: row.updatedAt != null ? String(row.updatedAt) : row.updated_at != null ? String(row.updated_at) : undefined,
  };
}

export class DbStorage implements IStorage {
  async getTraders(): Promise<Trader[]> {
    const rows = await db.select().from(tradersTable);
    return rows as Trader[];
  }

  async getTrader(id: string): Promise<Trader | undefined> {
    const rows = await db.select().from(tradersTable).where(eq(tradersTable.id, id)).limit(1);
    return (rows[0] as Trader) ?? undefined;
  }

  async createTrader(trader: InsertTrader): Promise<Trader> {
    const [{ value: c }] = await db.select({ value: count() }).from(tradersTable);
    const id = `TRD${String(Number(c ?? 0) + 1).padStart(3, "0")}`;
    const created = {
      ...trader,
      id,
      createdAt: now(),
    };
    await db.insert(tradersTable).values(created);
    return created as Trader;
  }

  async updateTrader(id: string, trader: Partial<Trader>): Promise<Trader | undefined> {
    const existing = await this.getTrader(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...trader, updatedAt: now() };
    await db.update(tradersTable).set(updated).where(eq(tradersTable.id, id));
    return updated as Trader;
  }

  async deleteTrader(id: string): Promise<boolean> {
    const deleted = await db.delete(tradersTable).where(eq(tradersTable.id, id)).returning({ id: tradersTable.id });
    return deleted.length > 0;
  }

  async getInvoices(): Promise<Invoice[]> {
    const rows = await db.select().from(invoicesTable);
    return rows as Invoice[];
  }

  async getInvoice(id: string): Promise<Invoice | undefined> {
    const rows = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id)).limit(1);
    return (rows[0] as Invoice) ?? undefined;
  }

  async createInvoice(invoice: InsertInvoice): Promise<Invoice> {
    const year = new Date().getFullYear();
    const [{ value: c }] = await db.select({ value: count() }).from(invoicesTable);
    const id = `INV-${year}-${String(Number(c ?? 0) + 1).padStart(4, "0")}`;
    const created = { ...invoice, id, createdAt: now() };
    await db.insert(invoicesTable).values(created);
    return created as Invoice;
  }

  async updateInvoice(id: string, invoice: Partial<Invoice>): Promise<Invoice | undefined> {
    const existing = await this.getInvoice(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...invoice, updatedAt: now() };
    await db.update(invoicesTable).set(updated).where(eq(invoicesTable.id, id));
    return updated as Invoice;
  }

  async deleteInvoice(id: string): Promise<boolean> {
    const deleted = await db.delete(invoicesTable).where(eq(invoicesTable.id, id)).returning({ id: invoicesTable.id });
    return deleted.length > 0;
  }

  async getReceipts(): Promise<Receipt[]> {
    const rows = await db.select().from(receiptsTable);
    return rows as Receipt[];
  }

  async getReceipt(id: string): Promise<Receipt | undefined> {
    const rows = await db.select().from(receiptsTable).where(eq(receiptsTable.id, id)).limit(1);
    return (rows[0] as Receipt) ?? undefined;
  }

  async createReceipt(receipt: InsertReceipt): Promise<Receipt> {
    const year = new Date().getFullYear();
    const [{ value: c }] = await db.select({ value: count() }).from(receiptsTable);
    const id = `REC-${year}-${String(Number(c ?? 0) + 1).padStart(4, "0")}`;
    const created = { ...receipt, id, createdAt: now() };
    await db.insert(receiptsTable).values(created);
    return created as Receipt;
  }

  async updateReceipt(id: string, receipt: Partial<Receipt>): Promise<Receipt | undefined> {
    const existing = await this.getReceipt(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...receipt, updatedAt: now() };
    await db.update(receiptsTable).set(updated).where(eq(receiptsTable.id, id));
    return updated as Receipt;
  }

  async deleteReceipt(id: string): Promise<boolean> {
    const deleted = await db.delete(receiptsTable).where(eq(receiptsTable.id, id)).returning({ id: receiptsTable.id });
    return deleted.length > 0;
  }

  async getMarketFees(): Promise<MarketFee[]> {
    const rows = await db.select().from(marketFeesTable);
    return rows as MarketFee[];
  }

  async getMarketFee(id: string): Promise<MarketFee | undefined> {
    const rows = await db.select().from(marketFeesTable).where(eq(marketFeesTable.id, id)).limit(1);
    return (rows[0] as MarketFee) ?? undefined;
  }

  async createMarketFee(marketFee: InsertMarketFee): Promise<MarketFee> {
    const year = new Date().getFullYear();
    const [{ value: c }] = await db.select({ value: count() }).from(marketFeesTable);
    const id = `MF-${year}-${String(Number(c ?? 0) + 1).padStart(4, "0")}`;
    const created = { ...marketFee, id, createdAt: now() };
    await db.insert(marketFeesTable).values(created);
    return created as MarketFee;
  }

  async getAgreements(): Promise<Agreement[]> {
    const rows = await db.select().from(agreementsTable);
    return rows as Agreement[];
  }

  async getAgreement(id: string): Promise<Agreement | undefined> {
    const rows = await db.select().from(agreementsTable).where(eq(agreementsTable.id, id)).limit(1);
    return (rows[0] as Agreement) ?? undefined;
  }

  async createAgreement(agreement: InsertAgreement): Promise<Agreement> {
    const [{ value: c }] = await db.select({ value: count() }).from(agreementsTable);
    const id = `AGR-${String(Number(c ?? 0) + 1).padStart(3, "0")}`;
    const created = { ...agreement, id, createdAt: now() };
    await db.insert(agreementsTable).values(created);
    return created as Agreement;
  }

  async updateAgreement(id: string, agreement: Partial<Agreement>): Promise<Agreement | undefined> {
    const existing = await this.getAgreement(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...agreement, updatedAt: now() };
    await db.update(agreementsTable).set(updated).where(eq(agreementsTable.id, id));
    return updated as Agreement;
  }

  async getStockReturns(): Promise<StockReturn[]> {
    const rows = await db.select().from(stockReturnsTable);
    return (rows as Record<string, unknown>[]).map((row) => mapStockReturnRow(row)) as StockReturn[];
  }

  async createStockReturn(stockReturn: InsertStockReturn): Promise<StockReturn> {
    const id = randomUUID();
    const created = { ...stockReturn, id, createdAt: now() };
    await db.insert(stockReturnsTable).values(created);
    return created as StockReturn;
  }

  async getActivityLogs(): Promise<ActivityLog[]> {
    const rows = await db
      .select()
      .from(activityLogsTable)
      .orderBy(desc(activityLogsTable.timestamp))
      .limit(10);
    return rows as ActivityLog[];
  }

  async createActivityLog(log: Omit<ActivityLog, "id">): Promise<ActivityLog> {
    const id = randomUUID();
    const created = { ...log, id };
    await db.insert(activityLogsTable).values(created);
    return created as ActivityLog;
  }

  async seedData(): Promise<void> {
    /** Intentionally empty: no demo traders, invoices, receipts, or activity rows on empty DB. */
  }
}
