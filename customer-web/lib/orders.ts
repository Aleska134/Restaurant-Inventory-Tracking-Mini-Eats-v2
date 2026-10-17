import "server-only";
import { randomBytes } from "node:crypto";
import { store } from "./store";
import {
  CHANNEL_FEE_RATE,
  loadCatalog,
  menuItem,
  recipeFor,
  round2,
  servingsLeft,
  unitPrice,
  type LineInput,
} from "./catalog";
import { MODIFIERS, TRATTORIA_ID } from "./content";
import { barmadeMode, getRestaurantStatus } from "./barmade";
import { createBarmadeOrder, getBarmadeOrder, listBarmadeOrders } from "./barmade-orders";

export const STATUSES = ["RECEIVED", "PREPARING", "READY", "COMPLETED", "CANCELLED"] as const;
export type OrderStatus = (typeof STATUSES)[number];
export type Fulfillment = "to_go" | "for_here";

/** Canonical order, same shape as orders.json plus the customer-app fields. */
export interface Order {
  id: string;
  order_number: number;
  restaurant_id: string;
  status: OrderStatus;
  channel: "barmade";
  source: "barmade-web";
  fulfillment: Fulfillment;
  table_number: string | null;
  customer_id: string | null;
  customer_name: string;
  placed_at: string;
  business_date: string;
  items: {
    menuItemId: string;
    item_id: string;
    name: string;
    quantity: number;
    modifiers: string[];
    unitPrice: number;
    lineTotal: number;
  }[];
  total: number;
  gross_total: number;
  channel_fee_rate: number;
  channel_fee: number;
  net_total: number;
  consumed: { ingredientId: string; quantity: number }[];
  status_history: { status: OrderStatus; at: string }[];
  updated_at: string;
}

export class OrderError extends Error {
  constructor(
    public code: "invalid" | "sold_out" | "not_found" | "bad_transition" | "upstream",
    message: string,
    public detail?: unknown,
  ) {
    super(message);
  }
}

export interface NewOrder {
  customerId: string | null;
  customerName: string;
  fulfillment: Fulfillment;
  tableNumber?: string | null;
  items: LineInput[];
}

const MAX_QTY = 20;

export async function createOrder(input: NewOrder): Promise<Order> {
  // Restaurant closed → stop taking orders (manager closed the day).
  if (barmadeMode()) {
    const status = await getRestaurantStatus();
    if (status.closed) throw new OrderError("invalid", "The restaurant is closed and not taking orders right now.");
  }
  const name = input.customerName.trim().slice(0, 40);
  if (!name) throw new OrderError("invalid", "customerName is required");
  if (input.fulfillment !== "to_go" && input.fulfillment !== "for_here")
    throw new OrderError("invalid", "fulfillment must be to_go or for_here");
  if (!Array.isArray(input.items) || input.items.length === 0) throw new OrderError("invalid", "items is empty");

  const catalog = await loadCatalog();
  const { stock } = catalog;
  const items: Order["items"] = [];
  const consumed = new Map<string, number>();
  const soldOut: string[] = [];

  for (const line of input.items) {
    const m = menuItem(catalog, line.menuItemId);
    const qty = Math.floor(Number(line.quantity));
    if (!m || !(qty >= 1 && qty <= MAX_QTY)) throw new OrderError("invalid", `bad line: ${line.menuItemId}`);
    const mods = [...new Set(line.modifiers ?? [])].filter((x) => m.modifierIds.includes(x) && MODIFIERS[x]);
    if (mods.includes("extra_cheese") && mods.includes("no_cheese")) throw new OrderError("invalid", "conflicting modifiers");

    for (const [ing, q] of recipeFor(m, mods)) consumed.set(ing, (consumed.get(ing) ?? 0) + q * qty);
    const price = unitPrice(m, mods);
    items.push({
      menuItemId: m.id,
      item_id: m.key,
      name: m.name,
      quantity: qty,
      modifiers: mods,
      unitPrice: price,
      lineTotal: round2(price * qty),
    });
  }

  // Check the whole basket against estimated stock, so we never accept what the kitchen can't make.
  for (const [ing, need] of consumed) {
    if ((stock.get(ing) ?? 0) < need) {
      for (const it of items) {
        const m = menuItem(catalog, it.menuItemId)!;
        if (recipeFor(m, it.modifiers).has(ing) && !soldOut.includes(it.name)) soldOut.push(it.name);
      }
    }
  }
  for (const it of items) {
    if (servingsLeft(menuItem(catalog, it.menuItemId)!, stock, it.modifiers) < 1 && !soldOut.includes(it.name)) soldOut.push(it.name);
  }
  if (soldOut.length) throw new OrderError("sold_out", "Some items are sold out", soldOut);

  const total = round2(items.reduce((s, i) => s + i.lineTotal, 0));
  const rate = CHANNEL_FEE_RATE.barmade;
  const fee = round2(total * rate);
  const now = new Date();
  const tableNumber =
    input.fulfillment === "for_here" ? input.tableNumber?.toString().trim().slice(0, 8) || null : null;

  // The team's backend owns orders: it recomputes consumption, deducts inventory and records the movement.
  if (barmadeMode()) {
    return createBarmadeOrder({
      customerId: input.customerId,
      customerName: name,
      fulfillment: input.fulfillment,
      tableNumber,
      items,
      channelFeeRate: rate,
      placedAt: now,
      businessDate: businessDate(now),
    });
  }

  const n = await store().nextOrderNumber();
  const id = `BM-${n}-${randomBytes(3).toString("hex").toUpperCase()}`;
  const placedAt = now.toISOString();
  return store().insertOrder({
    id,
    order_number: n,
    restaurant_id: TRATTORIA_ID,
    status: "RECEIVED",
    channel: "barmade",
    source: "barmade-web",
    fulfillment: input.fulfillment,
    table_number: tableNumber,
    customer_id: input.customerId,
    customer_name: name,
    placed_at: placedAt,
    business_date: businessDate(now),
    items,
    total,
    gross_total: total,
    channel_fee_rate: rate,
    channel_fee: fee,
    net_total: round2(total - fee),
    consumed: [...consumed].map(([ingredientId, quantity]) => ({ ingredientId, quantity })),
    status_history: [{ status: "RECEIVED", at: placedAt }],
    updated_at: placedAt,
  });
}

export async function getOrder(id: string): Promise<Order | null> {
  return barmadeMode() ? getBarmadeOrder(id) : store().getOrder(id);
}

export async function listOrders(opts: { since?: string; customerId?: string; limit?: number }): Promise<Order[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  return barmadeMode() ? listBarmadeOrders({ ...opts, limit }) : store().listOrders({ ...opts, limit });
}

const NEXT: Record<OrderStatus, OrderStatus[]> = {
  RECEIVED: ["PREPARING", "READY", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

export async function setStatus(id: string, status: OrderStatus): Promise<Order> {
  if (barmadeMode())
    throw new OrderError("bad_transition", "Order status is managed by the BarMade backend; update it there.");
  const updated = await store().updateOrder(id, (current) => {
    if (current.status === status) return null;
    if (!NEXT[current.status]?.includes(status))
      throw new OrderError("bad_transition", `cannot go from ${current.status} to ${status}`);
    const at = new Date().toISOString();
    return { status, updated_at: at, status_history: [...(current.status_history ?? []), { status, at }] };
  });
  if (!updated) throw new OrderError("not_found", "order not found");
  return updated;
}

export function businessDate(d: Date) {
  // Dataset timezone (metadata.json): America/New_York
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}
