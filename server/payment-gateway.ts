/**
 * Payment gateway pluggable adapter (stub default). Set PAYMENT_GATEWAY_MODE=stub|none.
 * Client Phase 1: cash and cheque only; electronic gateways stay pending until confirmed.
 * Wire a real provider (SBI ePay / NSDL / etc.) by extending createGatewayAdapter when keys are set.
 */
export type GatewayMode = "stub" | "none";

export interface PaymentGatewayAdapter {
  readonly mode: GatewayMode;
  /** Human-readable status for health / admin. */
  describe(): string;
}

function envMode(): GatewayMode {
  const m = (process.env.PAYMENT_GATEWAY_MODE || "stub").toLowerCase();
  if (m === "none" || m === "off" || m === "disabled") return "none";
  return "stub";
}

const stubAdapter: PaymentGatewayAdapter = {
  mode: "stub",
  describe() {
    return "stub — Phase 1: cash/cheque in-app; no live gateway capture yet";
  },
};

const noneAdapter: PaymentGatewayAdapter = {
  mode: "none",
  describe() {
    return "none (gateway integration disabled)";
  },
};

export function getPaymentGatewayAdapter(): PaymentGatewayAdapter {
  return envMode() === "none" ? noneAdapter : stubAdapter;
}
