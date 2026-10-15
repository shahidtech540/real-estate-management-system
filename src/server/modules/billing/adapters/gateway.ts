import { createHash } from "node:crypto";
import { HttpError } from "@/server/auth/guards";
export interface PaymentGateway {
  confirm(input: {
    invoiceId: string;
    amountMinor: number;
    requestId: string;
  }): { referenceNumber: string; mode: "mock" };
}
// Deterministic simulator for local development. Never pretends to charge a real wallet/card.
export function getPaymentGateway(
  provider: "jazzcash" | "easypaisa" | "stripe",
): PaymentGateway {
  if ((process.env.PAYMENT_PROVIDER_MODE || "mock") !== "mock")
    throw new HttpError(
      503,
      "LIVE_GATEWAY_NOT_CONFIGURED",
      "Live gateway processing is not enabled. Record a verified external payment instead.",
    );
  return {
    confirm: (input) => ({
      referenceNumber: `MOCK-${provider}-${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24)}`,
      mode: "mock",
    }),
  };
}
