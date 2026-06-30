/**
 * M-04 market transaction wizard — cases A–G (client mockups).
 */
export type MarketTransactionCaseId = "A" | "B" | "C" | "D" | "E" | "F" | "G";

export type MarketTransactionCaptureMode = "Normal" | "FlyingSquad" | "YardInspection";

export type MarketTransactionFeePayer = "Originator" | "Receiver";

export type MarketTransactionCommoditySource = "Local" | "OutsideState";

export type MarketTransactionSellerType = "Farmer" | "Trader";

export type MarketTransactionFarmerType = "Local" | "OutsideState";

export type MarketTransactionStatus = "Draft" | "Finalized" | "Voided";
/** Draft = suspended counter entry only (not a workflow state). Finalized = effective on submit. */

export type MarketTransactionCaseMeta = {
  id: MarketTransactionCaseId;
  title: string;
  subtitle: string;
  receiptSummary: string;
  requiresTraderLicence: boolean;
  allowsExpiredLicence: boolean;
  requiresManualTrader: boolean;
  requiresReceiverTrader: boolean;
  requiresFeePayer: boolean;
  requiresFarmer: boolean;
  requiresTransitFields: boolean;
  allowsFine: boolean;
  usesSecurityDeposit: boolean;
  defaultAdminCharges: number;
  defaultSecurityDeposit: number;
};

export const MARKET_TRANSACTION_CASES: Record<MarketTransactionCaseId, MarketTransactionCaseMeta> = {
  A: {
    id: "A",
    title: "Licensed purchase",
    subtitle: "License holder purchase from farmer (local / outside) or trader from outside state",
    receiptSummary: "Market Fee",
    requiresTraderLicence: true,
    allowsExpiredLicence: false,
    requiresManualTrader: false,
    requiresReceiverTrader: false,
    requiresFeePayer: false,
    requiresFarmer: true,
    requiresTransitFields: false,
    allowsFine: false,
    usesSecurityDeposit: false,
    defaultAdminCharges: 0,
    defaultSecurityDeposit: 0,
  },
  B: {
    id: "B",
    title: "Expired licence holder",
    subtitle: "Expired licence holder — market fee + fine",
    receiptSummary: "Market Fee + Fine",
    requiresTraderLicence: true,
    allowsExpiredLicence: true,
    requiresManualTrader: false,
    requiresReceiverTrader: false,
    requiresFeePayer: false,
    requiresFarmer: true,
    requiresTransitFields: false,
    allowsFine: true,
    usesSecurityDeposit: false,
    defaultAdminCharges: 0,
    defaultSecurityDeposit: 0,
  },
  C: {
    id: "C",
    title: "Unregistered trader",
    subtitle: "Unregistered trader bringing notified commodities into Goa",
    receiptSummary: "Market Fee + Fine",
    requiresTraderLicence: false,
    allowsExpiredLicence: false,
    requiresManualTrader: true,
    requiresReceiverTrader: false,
    requiresFeePayer: false,
    requiresFarmer: true,
    requiresTransitFields: false,
    allowsFine: true,
    usesSecurityDeposit: false,
    defaultAdminCharges: 0,
    defaultSecurityDeposit: 0,
  },
  D: {
    id: "D",
    title: "Trader to trader (within Goa)",
    subtitle: "Trader purchase within Goa — origin and destination traders",
    receiptSummary: "Market Fee",
    requiresTraderLicence: true,
    allowsExpiredLicence: false,
    requiresManualTrader: false,
    requiresReceiverTrader: true,
    requiresFeePayer: true,
    requiresFarmer: false,
    requiresTransitFields: false,
    allowsFine: false,
    usesSecurityDeposit: false,
    defaultAdminCharges: 0,
    defaultSecurityDeposit: 0,
  },
  E: {
    id: "E",
    title: "Transit through Goa",
    subtitle: "Transit through Goa — security deposit + administrative charges",
    receiptSummary: "Security Deposit + Admin Charges",
    requiresTraderLicence: false,
    allowsExpiredLicence: false,
    requiresManualTrader: false,
    requiresReceiverTrader: false,
    requiresFeePayer: false,
    requiresFarmer: false,
    requiresTransitFields: true,
    allowsFine: false,
    usesSecurityDeposit: true,
    defaultAdminCharges: 50,
    defaultSecurityDeposit: 1000,
  },
  F: {
    id: "F",
    title: "Permit transport (outside state)",
    subtitle: "Permit to transport notified commodities outside Goa",
    receiptSummary: "Market Fee",
    requiresTraderLicence: true,
    allowsExpiredLicence: false,
    requiresManualTrader: false,
    requiresReceiverTrader: false,
    requiresFeePayer: false,
    requiresFarmer: true,
    requiresTransitFields: false,
    allowsFine: false,
    usesSecurityDeposit: false,
    defaultAdminCharges: 0,
    defaultSecurityDeposit: 0,
  },
  G: {
    id: "G",
    title: "Flying squad / yard inspection",
    subtitle: "Found by flying squad or yard inspection team",
    receiptSummary: "Market Fee ± Fine",
    requiresTraderLicence: true,
    allowsExpiredLicence: true,
    requiresManualTrader: false,
    requiresReceiverTrader: false,
    requiresFeePayer: false,
    requiresFarmer: false,
    requiresTransitFields: false,
    allowsFine: true,
    usesSecurityDeposit: false,
    defaultAdminCharges: 0,
    defaultSecurityDeposit: 0,
  },
};

export function isMarketTransactionCaseId(v: string): v is MarketTransactionCaseId {
  return v === "A" || v === "B" || v === "C" || v === "D" || v === "E" || v === "F" || v === "G";
}

export type MarketTransactionCommodityLineInput = {
  commodityId: string;
  quantity: number;
  unit: string;
  ratePerUnit: number;
  marketFeePercent?: number;
};

export type MarketTransactionWizardInput = {
  caseType: MarketTransactionCaseId;
  entryLocationId: string;
  transactionDate: string;
  transactionTime?: string | null;
  captureMode?: MarketTransactionCaptureMode;
  captureLocationText?: string | null;
  vehicleNumber?: string | null;
  vehicleMake?: string | null;
  vehicleCapacityKg?: number | null;
  traderLicenceId?: string | null;
  traderManualName?: string | null;
  traderManualContact?: string | null;
  traderManualAddress?: string | null;
  receiverTraderLicenceId?: string | null;
  feePayer?: MarketTransactionFeePayer | null;
  sellerType?: MarketTransactionSellerType | null;
  farmerType?: MarketTransactionFarmerType | null;
  farmerName?: string | null;
  farmerKrishiCard?: string | null;
  farmerContact?: string | null;
  farmerAddress?: string | null;
  commoditySource?: MarketTransactionCommoditySource | null;
  placeOfOrigin?: string | null;
  originatingState?: string | null;
  destinationState?: string | null;
  exitCheckpostIds?: string[];
  anyExitCheckpost?: boolean;
  fineAmount?: number;
  securityDepositAmount?: number;
  adminChargesAmount?: number;
  collectFine?: boolean;
  commodities: MarketTransactionCommodityLineInput[];
};

export type MarketTransactionCalculatedLine = {
  commodityId: string;
  quantity: number;
  unit: string;
  ratePerUnit: number;
  commodityValue: number;
  marketFeePercent: number;
  marketFeeAmount: number;
};

export type MarketTransactionCalculation = {
  lines: MarketTransactionCalculatedLine[];
  totalCommodityValue: number;
  totalMarketFee: number;
  fineAmount: number;
  securityDepositAmount: number;
  adminChargesAmount: number;
  totalPayable: number;
  receiptRevenueHead: "MarketFee" | "Miscellaneous";
};

export function computeMarketTransactionTotals(
  caseType: MarketTransactionCaseId,
  lines: MarketTransactionCalculatedLine[],
  opts: {
    fineAmount?: number;
    securityDepositAmount?: number;
    adminChargesAmount?: number;
    collectFine?: boolean;
  },
): MarketTransactionCalculation {
  const meta = MARKET_TRANSACTION_CASES[caseType];
  const totalCommodityValue = Math.round(lines.reduce((s, l) => s + l.commodityValue, 0) * 100) / 100;
  const totalMarketFee = Math.round(lines.reduce((s, l) => s + l.marketFeeAmount, 0) * 100) / 100;
  const fineAmount =
    meta.allowsFine && opts.collectFine !== false
      ? Math.round(Math.max(0, Number(opts.fineAmount ?? 0)) * 100) / 100
      : 0;
  const securityDepositAmount = meta.usesSecurityDeposit
    ? Math.round(Math.max(0, Number(opts.securityDepositAmount ?? meta.defaultSecurityDeposit)) * 100) / 100
    : 0;
  const adminChargesAmount = meta.usesSecurityDeposit
    ? Math.round(Math.max(0, Number(opts.adminChargesAmount ?? meta.defaultAdminCharges)) * 100) / 100
    : 0;

  let totalPayable = 0;
  let receiptRevenueHead: "MarketFee" | "Miscellaneous" = "MarketFee";
  if (meta.usesSecurityDeposit) {
    totalPayable = Math.round((securityDepositAmount + adminChargesAmount) * 100) / 100;
    receiptRevenueHead = "Miscellaneous";
  } else {
    totalPayable = Math.round((totalMarketFee + fineAmount) * 100) / 100;
    receiptRevenueHead = "MarketFee";
  }

  return {
    lines,
    totalCommodityValue,
    totalMarketFee,
    fineAmount,
    securityDepositAmount,
    adminChargesAmount,
    totalPayable,
    receiptRevenueHead,
  };
}
