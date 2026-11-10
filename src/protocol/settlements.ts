/**
 * CoopCart settlement filings.
 * This is a node-side book for tax and the protocol fee split.
 * It does not spend a validator and it is not a UTxO. Cardano settlement
 * stays the transaction CoopCart already checked. Restarting the process
 * clears the log.
 */

export type FiledSettlement = {
  id: string;
  filed_at: string;
  kind: "coopcart.settlement.v1";
  event: "settled" | "shortfall" | "cancelled";
  order_id: string;
  store_slug: string;
  payment_method: "cardano" | "card" | "pay_at_pickup";
  currency: string;
  jurisdiction: string;
  subtotal_cents: number;
  tax_cents: number;
  tax_rate_bps: number;
  fee_cents: number;
  fee_bps: number;
  cashback_cents: number;
  platform_cents: number;
  refund_due_cents: number;
  seller_did: string | null;
  buyer_did: string | null;
  seller_ring: "confirmed" | "none";
  buyer_ring: "confirmed" | "none";
  fee_allocation: { ubi_cents: number; validators_cents: number; treasury_cents: number };
  cardano_tx: string | null;
  network: string | null;
  bioregion: string | null;
};

const log: FiledSettlement[] = [];

const EVENTS = new Set(["settled", "shortfall", "cancelled"]);
const METHODS = new Set(["cardano", "card", "pay_at_pickup"]);

function int(v: unknown, name: string): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
}

function ring(v: unknown): "confirmed" | "none" {
  return v === "confirmed" ? "confirmed" : "none";
}

function did(v: unknown): string | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (s.length > 160) throw new Error("DID is too long");
  return s;
}

export function feeSplit(platformCents: number) {
  const ubi = Math.floor((platformCents * 50) / 100);
  const validators = Math.floor((platformCents * 30) / 100);
  const treasury = platformCents - ubi - validators;
  return { ubi_cents: ubi, validators_cents: validators, treasury_cents: treasury };
}

export function fileSettlement(args: Record<string, unknown>): FiledSettlement {
  const kind = String(args.kind ?? "coopcart.settlement.v1");
  if (kind !== "coopcart.settlement.v1") throw new Error("kind must be coopcart.settlement.v1");
  const event = String(args.event ?? "settled");
  if (!EVENTS.has(event)) throw new Error("event must be settled, shortfall, or cancelled");
  const payment_method = String(args.payment_method ?? "");
  if (!METHODS.has(payment_method)) throw new Error("payment_method must be cardano, card, or pay_at_pickup");

  const order_id = String(args.order_id ?? "").trim();
  if (order_id.length < 8 || order_id.length > 80) throw new Error("order_id is required");
  const store_slug = String(args.store_slug ?? "").trim().slice(0, 80);
  if (!store_slug) throw new Error("store_slug is required");

  const fee_bps = int(args.fee_bps ?? 0, "fee_bps");
  if (payment_method === "cardano" && fee_bps > 100) throw new Error("Cardano fee is capped at 100 bps");
  if (fee_bps > 5000) throw new Error("fee_bps is out of range");

  const fee_cents = int(args.fee_cents ?? 0, "fee_cents");
  const cashback_cents = int(args.cashback_cents ?? 0, "cashback_cents");
  const platform_cents = int(args.platform_cents ?? 0, "platform_cents");
  if (cashback_cents > fee_cents) throw new Error("cash back cannot exceed the fee");
  if (platform_cents !== fee_cents - cashback_cents) throw new Error("platform_cents must equal fee minus cash back");

  const split = feeSplit(platform_cents);
  const given = args.fee_allocation as Record<string, unknown> | undefined;
  if (given) {
    if (int(given.ubi_cents, "ubi_cents") !== split.ubi_cents) throw new Error("UBI share must be 50% of the platform fee");
    if (int(given.validators_cents, "validators_cents") !== split.validators_cents) throw new Error("validator share must be 30% of the platform fee");
    if (int(given.treasury_cents, "treasury_cents") !== split.treasury_cents) throw new Error("treasury share must be the remainder");
  }

  const prior = log.find((r) => r.order_id === order_id && r.event === event);
  if (prior) return prior;

  const row: FiledSettlement = {
    id: `stl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    filed_at: new Date().toISOString(),
    kind: "coopcart.settlement.v1",
    event: event as FiledSettlement["event"],
    order_id,
    store_slug,
    payment_method: payment_method as FiledSettlement["payment_method"],
    currency: String(args.currency ?? "usd").slice(0, 8),
    jurisdiction: String(args.jurisdiction ?? "UNSET").slice(0, 16),
    subtotal_cents: int(args.subtotal_cents ?? 0, "subtotal_cents"),
    tax_cents: int(args.tax_cents ?? 0, "tax_cents"),
    tax_rate_bps: int(args.tax_rate_bps ?? 0, "tax_rate_bps"),
    fee_cents,
    fee_bps,
    cashback_cents,
    platform_cents,
    refund_due_cents: int(args.refund_due_cents ?? 0, "refund_due_cents"),
    seller_did: did(args.seller_did),
    buyer_did: did(args.buyer_did),
    seller_ring: ring(args.seller_ring),
    buyer_ring: ring(args.buyer_ring),
    fee_allocation: split,
    cardano_tx: args.cardano_tx ? String(args.cardano_tx).slice(0, 80) : null,
    network: args.network ? String(args.network).slice(0, 16) : null,
    bioregion: args.bioregion ? String(args.bioregion).slice(0, 64) : null,
  };
  log.unshift(row);
  if (log.length > 500) log.pop();
  return row;
}

export function listSettlements(store?: string): FiledSettlement[] {
  if (!store) return [...log];
  return log.filter((r) => r.store_slug === store);
}
