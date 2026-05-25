/** Payee linking rules from Manual_Receipt_Scenarios.xlsx (Receipts sheet). */
export type ManualReceiptPayeeRule =
  | "tenant_premises"
  | "party_trader_entity_new"
  | "party_with_assistant"
  | "trader_market_fee"
  | "trader_registration"
  | "trader_renewal"
  | "trader_upgradation"
  | "deposit";

export type ManualReceiptPartyType = "Trader" | "Entity" | "Assistant" | "NewParty";

export function partyTypesForPayeeRule(rule: ManualReceiptPayeeRule): ManualReceiptPartyType[] {
  switch (rule) {
    case "tenant_premises":
      return ["Trader", "Entity"];
    case "party_trader_entity_new":
      return ["Trader", "Entity", "NewParty"];
    case "party_with_assistant":
      return ["Trader", "Assistant", "Entity", "NewParty"];
    case "trader_market_fee":
      return ["Trader"];
    case "trader_registration":
    case "trader_renewal":
    case "trader_upgradation":
      return ["Trader", "Assistant"];
    case "deposit":
      return ["Trader", "Entity", "NewParty"];
    default:
      return ["Trader", "Entity", "NewParty"];
  }
}

export function inferPayeeRuleFromLinkText(link: string): ManualReceiptPayeeRule {
  const t = String(link ?? "").toLowerCase();
  if (t.includes("market fee due") || (t.includes("market fee") && t.includes("trader holding"))) {
    return "trader_market_fee";
  }
  if (t.includes("new trader") && t.includes("registration")) return "trader_registration";
  if (t.includes("renewal")) return "trader_renewal";
  if (t.includes("upgradation") || t.includes("upgaration")) return "trader_upgradation";
  if (t.includes("deposit")) return "deposit";
  if (t.includes("assistant") && t.includes("entity")) return "party_with_assistant";
  if (t.includes("occupancy") || t.includes("premises allotment") || t.includes("active tenant")) {
    return "tenant_premises";
  }
  if (t.includes("trader") && t.includes("entity") && t.includes("new party")) {
    return "party_trader_entity_new";
  }
  return "party_trader_entity_new";
}

export function revenueHeadForLedgerName(name: string): string {
  const n = String(name ?? "").trim().toLowerCase();
  if (n === "rent" || n.includes("interest on rent")) return "Rent";
  if (n.includes("market fee")) return "MarketFee";
  if (n.includes("license") || n.includes("licence") || n.includes("godown registration")) return "LicenceFee";
  if (n.includes("security deposit") || n.includes("individual deposit")) return "SecurityDeposit";
  if (n === "cgst" || n === "sgst") return "GSTInvoice";
  return "Miscellaneous";
}

export function normalizeLedgerName(name: string): string {
  return String(name ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/miscallaneous income/i, "Miscallaneous Income");
}
