import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { 
  insertTraderSchema, 
  insertInvoiceSchema, 
  insertReceiptSchema, 
  insertMarketFeeSchema,
  insertAgreementSchema,
  insertStockReturnSchema
} from "@shared/schema";
import { z } from "zod";

const updateTraderSchema = insertTraderSchema.partial();
const updateInvoiceSchema = insertInvoiceSchema.partial();
const updateReceiptSchema = insertReceiptSchema.partial();
const updateAgreementSchema = insertAgreementSchema.partial();

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await storage.seedData();

  // Traders
  app.get("/api/traders", async (req, res) => {
    try {
      const traders = await storage.getTraders();
      res.json(traders);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch traders" });
    }
  });

  app.get("/api/traders/:id", async (req, res) => {
    try {
      const trader = await storage.getTrader(req.params.id);
      if (!trader) return res.status(404).json({ error: "Trader not found" });
      res.json(trader);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch trader" });
    }
  });

  app.post("/api/traders", async (req, res) => {
    try {
      const validatedData = insertTraderSchema.parse(req.body);
      const trader = await storage.createTrader(validatedData);
      await storage.createActivityLog({
        action: 'Trader Registered',
        module: 'Traders',
        user: 'Super Admin',
        timestamp: new Date().toISOString(),
      });
      res.status(201).json(trader);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create trader" });
    }
  });

  app.put("/api/traders/:id", async (req, res) => {
    try {
      const validatedData = updateTraderSchema.parse(req.body);
      const trader = await storage.updateTrader(req.params.id, validatedData);
      if (!trader) return res.status(404).json({ error: "Trader not found" });
      res.json(trader);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update trader" });
    }
  });

  app.delete("/api/traders/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteTrader(req.params.id);
      if (!deleted) return res.status(404).json({ error: "Trader not found" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete trader" });
    }
  });

  // Invoices
  app.get("/api/invoices", async (req, res) => {
    try {
      const invoices = await storage.getInvoices();
      res.json(invoices);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch invoices" });
    }
  });

  app.get("/api/invoices/:id", async (req, res) => {
    try {
      const invoice = await storage.getInvoice(req.params.id);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      res.json(invoice);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch invoice" });
    }
  });

  app.post("/api/invoices", async (req, res) => {
    try {
      const validatedData = insertInvoiceSchema.parse(req.body);
      const invoice = await storage.createInvoice(validatedData);
      await storage.createActivityLog({
        action: 'Invoice Generated',
        module: 'Rent/Tax',
        user: 'Super Admin',
        timestamp: new Date().toISOString(),
      });
      res.status(201).json(invoice);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create invoice" });
    }
  });

  app.put("/api/invoices/:id", async (req, res) => {
    try {
      const validatedData = updateInvoiceSchema.parse(req.body);
      const invoice = await storage.updateInvoice(req.params.id, validatedData);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      res.json(invoice);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update invoice" });
    }
  });

  app.delete("/api/invoices/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteInvoice(req.params.id);
      if (!deleted) return res.status(404).json({ error: "Invoice not found" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete invoice" });
    }
  });

  // Receipts
  app.get("/api/receipts", async (req, res) => {
    try {
      const receipts = await storage.getReceipts();
      res.json(receipts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch receipts" });
    }
  });

  app.get("/api/receipts/:id", async (req, res) => {
    try {
      const receipt = await storage.getReceipt(req.params.id);
      if (!receipt) return res.status(404).json({ error: "Receipt not found" });
      res.json(receipt);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch receipt" });
    }
  });

  app.post("/api/receipts", async (req, res) => {
    try {
      const validatedData = insertReceiptSchema.parse(req.body);
      const receipt = await storage.createReceipt(validatedData);
      await storage.createActivityLog({
        action: 'Receipt Created',
        module: 'Receipts',
        user: 'Super Admin',
        timestamp: new Date().toISOString(),
      });
      res.status(201).json(receipt);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create receipt" });
    }
  });

  app.put("/api/receipts/:id", async (req, res) => {
    try {
      const validatedData = updateReceiptSchema.parse(req.body);
      const receipt = await storage.updateReceipt(req.params.id, validatedData);
      if (!receipt) return res.status(404).json({ error: "Receipt not found" });
      res.json(receipt);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update receipt" });
    }
  });

  app.delete("/api/receipts/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteReceipt(req.params.id);
      if (!deleted) return res.status(404).json({ error: "Receipt not found" });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete receipt" });
    }
  });

  // Market Fee
  app.get("/api/marketfees", async (req, res) => {
    try {
      const marketFees = await storage.getMarketFees();
      res.json(marketFees);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch market fees" });
    }
  });

  app.post("/api/marketfees", async (req, res) => {
    try {
      const validatedData = insertMarketFeeSchema.parse(req.body);
      const marketFee = await storage.createMarketFee(validatedData);
      await storage.createActivityLog({
        action: 'Market Fee Entry',
        module: 'Market Fee',
        user: 'Super Admin',
        timestamp: new Date().toISOString(),
      });
      res.status(201).json(marketFee);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create market fee entry" });
    }
  });

  // Agreements
  app.get("/api/agreements", async (req, res) => {
    try {
      const agreements = await storage.getAgreements();
      res.json(agreements);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch agreements" });
    }
  });

  app.post("/api/agreements", async (req, res) => {
    try {
      const validatedData = insertAgreementSchema.parse(req.body);
      const agreement = await storage.createAgreement(validatedData);
      res.status(201).json(agreement);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create agreement" });
    }
  });

  app.put("/api/agreements/:id", async (req, res) => {
    try {
      const validatedData = updateAgreementSchema.parse(req.body);
      const agreement = await storage.updateAgreement(req.params.id, validatedData);
      if (!agreement) return res.status(404).json({ error: "Agreement not found" });
      res.json(agreement);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update agreement" });
    }
  });

  // Stock Returns
  app.get("/api/stockreturns", async (req, res) => {
    try {
      const stockReturns = await storage.getStockReturns();
      res.json(stockReturns);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch stock returns" });
    }
  });

  app.post("/api/stockreturns", async (req, res) => {
    try {
      const validatedData = insertStockReturnSchema.parse(req.body);
      const stockReturn = await storage.createStockReturn(validatedData);
      await storage.createActivityLog({
        action: 'Stock Returns Submitted',
        module: 'Market Fee',
        user: 'Super Admin',
        timestamp: new Date().toISOString(),
      });
      res.status(201).json(stockReturn);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Validation failed", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create stock return" });
    }
  });

  // Activity Logs
  app.get("/api/activity", async (req, res) => {
    try {
      const logs = await storage.getActivityLogs();
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch activity logs" });
    }
  });

  // Dashboard Stats
  app.get("/api/stats", async (req, res) => {
    try {
      const traders = await storage.getTraders();
      const invoices = await storage.getInvoices();
      const receipts = await storage.getReceipts();
      
      res.json({
        totalTraders: traders.length,
        activeInvoices: invoices.filter(i => i.status !== 'Paid').length,
        pendingReceipts: invoices.filter(i => i.status === 'Pending').length,
        todaysCollection: receipts.reduce((sum, r) => sum + r.total, 0),
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  return httpServer;
}
