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
    const [{ value: traderCount }] = await db.select({ value: count() }).from(tradersTable);
    if (Number(traderCount ?? 0) === 0) {
    const seedTraders: Trader[] = [
      {
        id: "TRD001",
        assetId: "MARG-2024-001",
        name: "Ramesh Naik",
        firmName: "Naik Traders",
        type: "Firm",
        mobile: "9822001001",
        email: "ramesh@naiktraders.com",
        aadhaar: "1234-5678-9012",
        pan: "ABCPN1234A",
        gst: "30ABCPN1234A1Z5",
        yardId: 1,
        yardName: "Margao Main Yard",
        premises: "Stall 14",
        premisesType: "Stall",
        registrationType: "Permanent",
        commodities: ["Vegetables", "Fruits"],
        status: "Active",
        agreementStart: "2024-01-01",
        agreementEnd: "2026-12-31",
        rentAmount: 5000,
        securityDeposit: 25000,
      },
      {
        id: "TRD002",
        assetId: "MARG-2024-002",
        name: "Priya Desai",
        firmName: "Desai & Sons",
        type: "Firm",
        mobile: "9822001002",
        email: "priya@desaisns.com",
        aadhaar: "2345-6789-0123",
        pan: "BCQPD2345B",
        gst: "30BCQPD2345B1Z6",
        yardId: 1,
        yardName: "Margao Main Yard",
        premises: "Godown 5",
        premisesType: "Godown",
        registrationType: "Permanent",
        commodities: ["Rice", "Wheat"],
        status: "Active",
        agreementStart: "2024-03-01",
        agreementEnd: "2027-02-28",
        rentAmount: 8000,
        securityDeposit: 40000,
      },
      {
        id: "TRD003",
        assetId: "POND-2024-001",
        name: "Santosh Kamat",
        firmName: "Kamat Vegetables",
        type: "Individual",
        mobile: "9822001003",
        email: "santosh.kamat@gmail.com",
        aadhaar: "3456-7890-1234",
        pan: "CDRPK3456C",
        yardId: 2,
        yardName: "Ponda Market Sub Yard",
        premises: "Stall 7",
        premisesType: "Stall",
        registrationType: "Temporary",
        commodities: ["Vegetables"],
        status: "Active",
        agreementStart: "2025-01-01",
        agreementEnd: "2025-12-31",
        rentAmount: 3000,
        securityDeposit: 15000,
      },
      {
        id: "TRD004",
        assetId: "MAPU-2024-001",
        name: "Fatima Shaikh",
        firmName: "Shaikh Fruits",
        type: "Firm",
        mobile: "9822001004",
        email: "fatima.shaikh@shaikhfruits.com",
        aadhaar: "4567-8901-2345",
        pan: "DESPF4567D",
        gst: "30DESPF4567D1Z7",
        yardId: 4,
        yardName: "Mapusa Market Sub Yard",
        premises: "Stall 12",
        premisesType: "Stall",
        registrationType: "Permanent",
        commodities: ["Fruits", "Coconut"],
        status: "Active",
        agreementStart: "2023-06-01",
        agreementEnd: "2026-05-31",
        rentAmount: 4500,
        securityDeposit: 22500,
      },
      {
        id: "TRD005",
        assetId: "MARG-2024-003",
        name: "Vijay Shetty",
        firmName: "Shetty Trading Co",
        type: "Pvt Ltd",
        mobile: "9822001005",
        email: "vijay@shettytrading.com",
        aadhaar: "5678-9012-3456",
        pan: "EFGPV5678E",
        gst: "30EFGPV5678E1Z8",
        yardId: 1,
        yardName: "Margao Main Yard",
        premises: "Godown 8",
        premisesType: "Godown",
        registrationType: "Permanent",
        commodities: ["Cashew", "Spices"],
        status: "Active",
        agreementStart: "2024-04-01",
        agreementEnd: "2027-03-31",
        rentAmount: 12000,
        securityDeposit: 60000,
      },
    ];
    for (const t of seedTraders) {
      await db.insert(tradersTable).values({ ...t, createdAt: now() });
    }

    const seedInvoices: InsertInvoice[] = [
      {
        traderId: "TRD001",
        traderName: "Ramesh Naik",
        premises: "Stall 14",
        yard: "Margao Main Yard",
        yardId: 1,
        month: "January 2026",
        invoiceDate: "2026-01-05",
        baseRent: 5000,
        cgst: 450,
        sgst: 450,
        interest: 0,
        total: 5900,
        tdsApplicable: false,
        tdsAmount: 0,
        status: "Paid",
      },
      {
        traderId: "TRD002",
        traderName: "Priya Desai",
        premises: "Godown 5",
        yard: "Margao Main Yard",
        yardId: 1,
        month: "January 2026",
        invoiceDate: "2026-01-05",
        baseRent: 8000,
        cgst: 720,
        sgst: 720,
        interest: 0,
        total: 9440,
        tdsApplicable: true,
        tdsAmount: 800,
        status: "Pending",
      },
      {
        traderId: "TRD003",
        traderName: "Santosh Kamat",
        premises: "Stall 7",
        yard: "Ponda Market Sub Yard",
        yardId: 2,
        month: "January 2026",
        invoiceDate: "2026-01-06",
        baseRent: 3000,
        cgst: 270,
        sgst: 270,
        interest: 150,
        total: 3690,
        tdsApplicable: false,
        tdsAmount: 0,
        status: "Overdue",
      },
    ];
    for (let i = 0; i < seedInvoices.length; i++) {
      const inv = seedInvoices[i];
      const id = `INV-2026-${String(i + 1).padStart(4, "0")}`;
      await db.insert(invoicesTable).values({ ...inv, id, createdAt: now() });
    }

    const seedReceipts: InsertReceipt[] = [
      {
        receiptNo: "REC-2026-0001",
        receiptDate: "2026-01-10",
        type: "Rent",
        traderId: "TRD001",
        traderName: "Ramesh Naik",
        head: "Rent",
        amount: 5000,
        cgst: 450,
        sgst: 450,
        total: 5900,
        paymentMode: "Online",
        transactionRef: "UTR123456789",
        yardId: 1,
        yardName: "Margao Main Yard",
        issuedBy: "Super Admin",
        status: "Active",
      },
      {
        receiptNo: "REC-2026-0002",
        receiptDate: "2026-01-12",
        type: "Rent",
        traderId: "TRD004",
        traderName: "Fatima Shaikh",
        head: "Rent",
        amount: 4500,
        cgst: 405,
        sgst: 405,
        total: 5310,
        paymentMode: "Cash",
        yardId: 4,
        yardName: "Mapusa Market Sub Yard",
        issuedBy: "Super Admin",
        status: "Active",
      },
    ];
    for (let i = 0; i < seedReceipts.length; i++) {
      const r = seedReceipts[i];
      const id = `REC-2026-${String(i + 1).padStart(4, "0")}`;
      await db.insert(receiptsTable).values({ ...r, id, createdAt: now() });
    }

    const seedLogs: Omit<ActivityLog, "id">[] = [
      { action: "Invoice Generated", module: "Rent/Tax", user: "Super Admin", timestamp: new Date().toISOString() },
      { action: "Receipt Created", module: "Receipts", user: "Super Admin", timestamp: new Date(Date.now() - 3600000).toISOString() },
      { action: "Trader Registered", module: "Traders", user: "Super Admin", timestamp: new Date(Date.now() - 86400000).toISOString() },
    ];
    for (const log of seedLogs) {
      await db.insert(activityLogsTable).values({ ...log, id: randomUUID() });
    }
    }

    const [{ value: stockReturnCount }] = await db.select({ value: count() }).from(stockReturnsTable);
    if (Number(stockReturnCount ?? 0) === 0) {
      const sampleStockReturns: InsertStockReturn[] = [
        {
          traderId: "TRD001",
          traderName: "Ramesh Naik",
          period: "2026-01",
          commodity: "Vegetables",
          openingBalance: 100,
          locallyProcured: 50,
          purchasedFromTrader: 20,
          sales: 120,
          closingBalance: 50,
          status: "Submitted",
        },
        {
          traderId: "TRD001",
          traderName: "Ramesh Naik",
          period: "2026-01",
          commodity: "Fruits",
          openingBalance: 80,
          locallyProcured: 40,
          purchasedFromTrader: 15,
          sales: 90,
          closingBalance: 45,
          status: "Submitted",
        },
        {
          traderId: "TRD003",
          traderName: "Santosh Kamat",
          period: "2026-01",
          commodity: "Vegetables",
          openingBalance: 60,
          locallyProcured: 30,
          purchasedFromTrader: 10,
          sales: 70,
          closingBalance: 30,
          status: "Submitted",
        },
      ];
      for (const sr of sampleStockReturns) {
        await this.createStockReturn(sr);
      }
    }
  }
}
