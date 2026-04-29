import { randomUUID } from "crypto";
import { DbStorage } from "./db-storage";
import type { 
  Trader, InsertTrader,
  Invoice, InsertInvoice,
  Receipt, InsertReceipt,
  MarketFee, InsertMarketFee,
  Agreement, InsertAgreement,
  StockReturn, InsertStockReturn,
  ActivityLog
} from "@shared/schema";

export interface IStorage {
  // Traders
  getTraders(): Promise<Trader[]>;
  getTrader(id: string): Promise<Trader | undefined>;
  createTrader(trader: InsertTrader): Promise<Trader>;
  updateTrader(id: string, trader: Partial<Trader>): Promise<Trader | undefined>;
  deleteTrader(id: string): Promise<boolean>;

  // Invoices
  getInvoices(): Promise<Invoice[]>;
  getInvoice(id: string): Promise<Invoice | undefined>;
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;
  updateInvoice(id: string, invoice: Partial<Invoice>): Promise<Invoice | undefined>;
  deleteInvoice(id: string): Promise<boolean>;

  // Receipts
  getReceipts(): Promise<Receipt[]>;
  getReceipt(id: string): Promise<Receipt | undefined>;
  createReceipt(receipt: InsertReceipt): Promise<Receipt>;
  updateReceipt(id: string, receipt: Partial<Receipt>): Promise<Receipt | undefined>;
  deleteReceipt(id: string): Promise<boolean>;

  // Market Fee
  getMarketFees(): Promise<MarketFee[]>;
  getMarketFee(id: string): Promise<MarketFee | undefined>;
  createMarketFee(marketFee: InsertMarketFee): Promise<MarketFee>;

  // Agreements
  getAgreements(): Promise<Agreement[]>;
  getAgreement(id: string): Promise<Agreement | undefined>;
  createAgreement(agreement: InsertAgreement): Promise<Agreement>;
  updateAgreement(id: string, agreement: Partial<Agreement>): Promise<Agreement | undefined>;

  // Stock Returns
  getStockReturns(): Promise<StockReturn[]>;
  createStockReturn(stockReturn: InsertStockReturn): Promise<StockReturn>;

  // Activity Logs
  getActivityLogs(): Promise<ActivityLog[]>;
  createActivityLog(log: Omit<ActivityLog, 'id'>): Promise<ActivityLog>;

  // Seed data
  seedData(): Promise<void>;
}

export class MemStorage implements IStorage {
  private traders: Map<string, Trader>;
  private invoices: Map<string, Invoice>;
  private receipts: Map<string, Receipt>;
  private marketFees: Map<string, MarketFee>;
  private agreements: Map<string, Agreement>;
  private stockReturns: Map<string, StockReturn>;
  private activityLogs: Map<string, ActivityLog>;

  constructor() {
    this.traders = new Map();
    this.invoices = new Map();
    this.receipts = new Map();
    this.marketFees = new Map();
    this.agreements = new Map();
    this.stockReturns = new Map();
    this.activityLogs = new Map();
  }

  // Traders
  async getTraders(): Promise<Trader[]> {
    return Array.from(this.traders.values());
  }

  async getTrader(id: string): Promise<Trader | undefined> {
    return this.traders.get(id);
  }

  async createTrader(trader: InsertTrader): Promise<Trader> {
    const id = `TRD${String(this.traders.size + 1).padStart(3, '0')}`;
    const newTrader: Trader = {
      ...trader,
      id,
      createdAt: new Date().toISOString(),
    };
    this.traders.set(id, newTrader);
    return newTrader;
  }

  async updateTrader(id: string, trader: Partial<Trader>): Promise<Trader | undefined> {
    const existing = this.traders.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...trader, updatedAt: new Date().toISOString() };
    this.traders.set(id, updated);
    return updated;
  }

  async deleteTrader(id: string): Promise<boolean> {
    return this.traders.delete(id);
  }

  // Invoices
  async getInvoices(): Promise<Invoice[]> {
    return Array.from(this.invoices.values());
  }

  async getInvoice(id: string): Promise<Invoice | undefined> {
    return this.invoices.get(id);
  }

  async createInvoice(invoice: InsertInvoice): Promise<Invoice> {
    const year = new Date().getFullYear();
    const id = `INV-${year}-${String(this.invoices.size + 1).padStart(4, '0')}`;
    const newInvoice: Invoice = {
      ...invoice,
      id,
      createdAt: new Date().toISOString(),
    };
    this.invoices.set(id, newInvoice);
    return newInvoice;
  }

  async updateInvoice(id: string, invoice: Partial<Invoice>): Promise<Invoice | undefined> {
    const existing = this.invoices.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...invoice, updatedAt: new Date().toISOString() };
    this.invoices.set(id, updated);
    return updated;
  }

  async deleteInvoice(id: string): Promise<boolean> {
    return this.invoices.delete(id);
  }

  // Receipts
  async getReceipts(): Promise<Receipt[]> {
    return Array.from(this.receipts.values());
  }

  async getReceipt(id: string): Promise<Receipt | undefined> {
    return this.receipts.get(id);
  }

  async createReceipt(receipt: InsertReceipt): Promise<Receipt> {
    const year = new Date().getFullYear();
    const id = `REC-${year}-${String(this.receipts.size + 1).padStart(4, '0')}`;
    const newReceipt: Receipt = {
      ...receipt,
      id,
      createdAt: new Date().toISOString(),
    };
    this.receipts.set(id, newReceipt);
    return newReceipt;
  }

  async updateReceipt(id: string, receipt: Partial<Receipt>): Promise<Receipt | undefined> {
    const existing = this.receipts.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...receipt, updatedAt: new Date().toISOString() };
    this.receipts.set(id, updated);
    return updated;
  }

  async deleteReceipt(id: string): Promise<boolean> {
    return this.receipts.delete(id);
  }

  // Market Fee
  async getMarketFees(): Promise<MarketFee[]> {
    return Array.from(this.marketFees.values());
  }

  async getMarketFee(id: string): Promise<MarketFee | undefined> {
    return this.marketFees.get(id);
  }

  async createMarketFee(marketFee: InsertMarketFee): Promise<MarketFee> {
    const year = new Date().getFullYear();
    const id = `MF-${year}-${String(this.marketFees.size + 1).padStart(4, '0')}`;
    const newMarketFee: MarketFee = {
      ...marketFee,
      id,
      createdAt: new Date().toISOString(),
    };
    this.marketFees.set(id, newMarketFee);
    return newMarketFee;
  }

  // Agreements
  async getAgreements(): Promise<Agreement[]> {
    return Array.from(this.agreements.values());
  }

  async getAgreement(id: string): Promise<Agreement | undefined> {
    return this.agreements.get(id);
  }

  async createAgreement(agreement: InsertAgreement): Promise<Agreement> {
    const id = `AGR-${String(this.agreements.size + 1).padStart(3, '0')}`;
    const newAgreement: Agreement = {
      ...agreement,
      id,
      createdAt: new Date().toISOString(),
    };
    this.agreements.set(id, newAgreement);
    return newAgreement;
  }

  async updateAgreement(id: string, agreement: Partial<Agreement>): Promise<Agreement | undefined> {
    const existing = this.agreements.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...agreement, updatedAt: new Date().toISOString() };
    this.agreements.set(id, updated);
    return updated;
  }

  // Stock Returns
  async getStockReturns(): Promise<StockReturn[]> {
    return Array.from(this.stockReturns.values());
  }

  async createStockReturn(stockReturn: InsertStockReturn): Promise<StockReturn> {
    const id = randomUUID();
    const newStockReturn: StockReturn = {
      ...stockReturn,
      id,
      createdAt: new Date().toISOString(),
    };
    this.stockReturns.set(id, newStockReturn);
    return newStockReturn;
  }

  // Activity Logs
  async getActivityLogs(): Promise<ActivityLog[]> {
    return Array.from(this.activityLogs.values()).sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    ).slice(0, 10);
  }

  async createActivityLog(log: Omit<ActivityLog, 'id'>): Promise<ActivityLog> {
    const id = randomUUID();
    const newLog: ActivityLog = { ...log, id };
    this.activityLogs.set(id, newLog);
    return newLog;
  }

  async seedData(): Promise<void> {
    /** Intentionally empty: no demo traders, invoices, receipts, or activity rows (matches DbStorage). */
  }
}

// Always use database. DATABASE_URL is required; in-memory storage is disabled.
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required. Add it to .env (see .env.example). In-memory storage is disabled."
  );
}
export const storage: IStorage = new DbStorage();
