import { randomUUID } from "crypto";
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
  private seeded: boolean = false;

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

  // Seed initial data
  async seedData(): Promise<void> {
    if (this.seeded) return;
    this.seeded = true;

    // Seed traders
    const traders: Trader[] = [
      { id: 'TRD001', assetId: 'MARG-2024-001', name: 'Ramesh Naik', firmName: 'Naik Traders', type: 'Firm', mobile: '9822001001', email: 'ramesh@naiktraders.com', aadhaar: '1234-5678-9012', pan: 'ABCPN1234A', gst: '30ABCPN1234A1Z5', yardId: 1, yardName: 'Margao Main Yard', premises: 'Stall 14', premisesType: 'Stall', registrationType: 'Permanent', commodities: ['Vegetables', 'Fruits'], status: 'Active', agreementStart: '2024-01-01', agreementEnd: '2026-12-31', rentAmount: 5000, securityDeposit: 25000 },
      { id: 'TRD002', assetId: 'MARG-2024-002', name: 'Priya Desai', firmName: 'Desai & Sons', type: 'Firm', mobile: '9822001002', email: 'priya@desaisns.com', aadhaar: '2345-6789-0123', pan: 'BCQPD2345B', gst: '30BCQPD2345B1Z6', yardId: 1, yardName: 'Margao Main Yard', premises: 'Godown 5', premisesType: 'Godown', registrationType: 'Permanent', commodities: ['Rice', 'Wheat'], status: 'Active', agreementStart: '2024-03-01', agreementEnd: '2027-02-28', rentAmount: 8000, securityDeposit: 40000 },
      { id: 'TRD003', assetId: 'POND-2024-001', name: 'Santosh Kamat', firmName: 'Kamat Vegetables', type: 'Individual', mobile: '9822001003', email: 'santosh.kamat@gmail.com', aadhaar: '3456-7890-1234', pan: 'CDRPK3456C', yardId: 2, yardName: 'Ponda Market Sub Yard', premises: 'Stall 7', premisesType: 'Stall', registrationType: 'Temporary', commodities: ['Vegetables'], status: 'Active', agreementStart: '2025-01-01', agreementEnd: '2025-12-31', rentAmount: 3000, securityDeposit: 15000 },
      { id: 'TRD004', assetId: 'MAPU-2024-001', name: 'Fatima Shaikh', firmName: 'Shaikh Fruits', type: 'Firm', mobile: '9822001004', email: 'fatima.shaikh@shaikhfruits.com', aadhaar: '4567-8901-2345', pan: 'DESPF4567D', gst: '30DESPF4567D1Z7', yardId: 4, yardName: 'Mapusa Market Sub Yard', premises: 'Stall 12', premisesType: 'Stall', registrationType: 'Permanent', commodities: ['Fruits', 'Coconut'], status: 'Active', agreementStart: '2023-06-01', agreementEnd: '2026-05-31', rentAmount: 4500, securityDeposit: 22500 },
      { id: 'TRD005', assetId: 'MARG-2024-003', name: 'Vijay Shetty', firmName: 'Shetty Trading Co', type: 'Pvt Ltd', mobile: '9822001005', email: 'vijay@shettytrading.com', aadhaar: '5678-9012-3456', pan: 'EFGPV5678E', gst: '30EFGPV5678E1Z8', yardId: 1, yardName: 'Margao Main Yard', premises: 'Godown 8', premisesType: 'Godown', registrationType: 'Permanent', commodities: ['Cashew', 'Spices'], status: 'Active', agreementStart: '2024-04-01', agreementEnd: '2027-03-31', rentAmount: 12000, securityDeposit: 60000 },
    ];
    traders.forEach(t => this.traders.set(t.id, t));

    // Seed invoices
    const invoices: Invoice[] = [
      { id: 'INV-2026-0001', traderId: 'TRD001', traderName: 'Ramesh Naik', premises: 'Stall 14', yard: 'Margao Main Yard', yardId: 1, month: 'January 2026', invoiceDate: '2026-01-05', baseRent: 5000, cgst: 450, sgst: 450, interest: 0, total: 5900, tdsApplicable: false, tdsAmount: 0, status: 'Paid' },
      { id: 'INV-2026-0002', traderId: 'TRD002', traderName: 'Priya Desai', premises: 'Godown 5', yard: 'Margao Main Yard', yardId: 1, month: 'January 2026', invoiceDate: '2026-01-05', baseRent: 8000, cgst: 720, sgst: 720, interest: 0, total: 9440, tdsApplicable: true, tdsAmount: 800, status: 'Pending' },
      { id: 'INV-2026-0003', traderId: 'TRD003', traderName: 'Santosh Kamat', premises: 'Stall 7', yard: 'Ponda Market Sub Yard', yardId: 2, month: 'January 2026', invoiceDate: '2026-01-06', baseRent: 3000, cgst: 270, sgst: 270, interest: 150, total: 3690, tdsApplicable: false, tdsAmount: 0, status: 'Overdue' },
    ];
    invoices.forEach(i => this.invoices.set(i.id, i));

    // Seed receipts
    const receipts: Receipt[] = [
      { id: 'REC-2026-0001', receiptNo: 'REC-2026-0001', receiptDate: '2026-01-10', type: 'Rent', traderId: 'TRD001', traderName: 'Ramesh Naik', head: 'Rent', amount: 5000, cgst: 450, sgst: 450, total: 5900, paymentMode: 'Online', transactionRef: 'UTR123456789', yardId: 1, yardName: 'Margao Main Yard', issuedBy: 'Super Admin', status: 'Active' },
      { id: 'REC-2026-0002', receiptNo: 'REC-2026-0002', receiptDate: '2026-01-12', type: 'Rent', traderId: 'TRD004', traderName: 'Fatima Shaikh', head: 'Rent', amount: 4500, cgst: 405, sgst: 405, total: 5310, paymentMode: 'Cash', yardId: 4, yardName: 'Mapusa Market Sub Yard', issuedBy: 'Super Admin', status: 'Active' },
    ];
    receipts.forEach(r => this.receipts.set(r.id, r));

    // Seed activity logs
    const logs: ActivityLog[] = [
      { id: '1', action: 'Invoice Generated', module: 'Rent/Tax', user: 'Super Admin', timestamp: new Date().toISOString() },
      { id: '2', action: 'Receipt Created', module: 'Receipts', user: 'Super Admin', timestamp: new Date(Date.now() - 3600000).toISOString() },
      { id: '3', action: 'Trader Registered', module: 'Traders', user: 'Super Admin', timestamp: new Date(Date.now() - 86400000).toISOString() },
    ];
    logs.forEach(l => this.activityLogs.set(l.id, l));
  }
}

export const storage = new MemStorage();
