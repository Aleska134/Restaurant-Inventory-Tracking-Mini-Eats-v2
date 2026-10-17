// Order ingestion — the live seam the customer frontend plugs into.
// Accepts a canonical order, persists it, walks each dish's recipe, writes a
// negative movement per ingredient (depletion), and raises/updates low-stock alerts.
// All quantities are plain-code; nothing here touches the LLM.

import { z } from 'zod';
import { prisma } from './prisma.js';
import { CHANNEL_FEE_RATES, getDemoNow } from './calc.js';

export const CanonicalOrderSchema = z.object({
  channel: z.enum(['dine_in', 'takeout', 'website', 'uber_eats', 'doordash', 'barmade']).optional().default('barmade'),
  placed_at: z.string().datetime().optional(),
  // Customer-app fields (BarMade customer-web contract). Stored on the order.
  source: z.string().optional(),
  fulfillment: z.enum(['to_go', 'for_here']).optional(),
  tableNumber: z.union([z.string(), z.number()]).nullable().optional(),
  customerName: z.string().optional(),
  customerId: z.string().optional(),
  items: z
    .array(
      z.object({
        // Accept BOTH dialects: our `item_id` (menu key) and the customer app's
        // `menuItemId` (menu id). At least one must be present.
        item_id: z.string().optional(),
        menuItemId: z.string().optional(),
        quantity: z.number().int().positive(),
        modifiers: z.array(z.string()).optional().default([]),
      }).refine((i) => i.item_id || i.menuItemId, { message: 'item_id or menuItemId required' }),
    )
    .min(1),
});

export type CanonicalOrder = z.infer<typeof CanonicalOrderSchema>;

function businessDateFor(d: Date): string {
  // Venue is America/New_York; business day cutoff kept simple (local calendar day).
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export async function ingestOrder(input: CanonicalOrder) {
  // Default to the demo "now" (current business-day cursor) so simulated and
  // demo orders land on the day the dashboard is showing. Real customer-frontend
  // orders pass their own placed_at and are honored as-is.
  const placedAt = input.placed_at ? new Date(input.placed_at) : await getDemoNow();
  const businessDate = businessDateFor(placedAt);

  // Resolve menu items + recipes. Accept BOTH dialects: item_id (menu key) and
  // menuItemId (menu id). Build a lookup over both.
  const refs = input.items.map((i) => (i.item_id ?? i.menuItemId)!);
  const menuItems = await prisma.menuItem.findMany({
    where: { OR: [{ key: { in: refs } }, { id: { in: refs } }] },
    include: { recipeLines: true },
  });
  const byKey = new Map(menuItems.map((m) => [m.key, m]));
  const byId = new Map(menuItems.map((m) => [m.id, m]));
  const resolve = (line: { item_id?: string; menuItemId?: string }) => {
    const ref = (line.item_id ?? line.menuItemId)!;
    return byKey.get(ref) ?? byId.get(ref);
  };
  const missing = input.items.filter((l) => !resolve(l)).map((l) => l.item_id ?? l.menuItemId);
  if (missing.length) {
    throw new HttpError(400, `Unknown menu item(s): ${missing.join(', ')}`);
  }
  // Reject dishes that are 86'd / unavailable.
  const unavailable = input.items.map(resolve).filter((m) => m && !m.available).map((m) => m!.name);
  if (unavailable.length) {
    throw new HttpError(409, JSON.stringify({ code: 'INSUFFICIENT_INVENTORY', message: 'Some items just sold out', details: { items: unavailable } }));
  }

  // Pre-flight inventory check: aggregate required usage and verify stock covers
  // it BEFORE writing anything. Returns 409 INSUFFICIENT_INVENTORY if short.
  const required = new Map<string, number>();
  for (const line of input.items) {
    const mi = resolve(line)!;
    for (const rl of mi.recipeLines) required.set(rl.ingredientId, (required.get(rl.ingredientId) ?? 0) + rl.quantity * line.quantity);
  }
  const shortIds: string[] = [];
  for (const [ingredientId, amount] of required) {
    const ing = await prisma.ingredient.findUnique({ where: { id: ingredientId }, include: { batches: true } });
    const have = ing ? ing.batches.reduce((s, b) => s + b.quantity, 0) : 0;
    if (have < amount) shortIds.push(ingredientId);
  }
  if (shortIds.length) {
    // name the dishes blocked by the short ingredients
    const blockedDishes = input.items.map(resolve).filter((m) => m!.recipeLines.some((rl) => shortIds.includes(rl.ingredientId))).map((m) => m!.id);
    throw new HttpError(409, JSON.stringify({ code: 'INSUFFICIENT_INVENTORY', message: 'Not enough stock to fulfil this order', details: { ingredientIds: shortIds, menuItemIds: blockedDishes } }));
  }

  const feeRate = CHANNEL_FEE_RATES[input.channel] ?? 0;
  let gross = 0;
  const orderItemsData = input.items.map((line) => {
    const mi = resolve(line)!;
    const lineTotal = mi.price * line.quantity;
    gross += lineTotal;
    return {
      menuItemId: mi.id,
      itemKey: mi.key,
      name: mi.name,
      quantity: line.quantity,
      unitPrice: mi.price,
      lineTotal,
      modifiers: line.modifiers ?? [],
    };
  });
  const channelFee = round(gross * feeRate);
  const net = round(gross - channelFee);

  const orderId = await nextOrderId();
  // Customer-app (barmade-web) orders enter the live lifecycle at RECEIVED;
  // internal/simulated orders are historical and complete immediately.
  const isCustomerOrder = input.source === 'barmade-web' || input.channel === 'barmade';
  const initialStatus = isCustomerOrder ? 'RECEIVED' : 'COMPLETED';

  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        id: orderId,
        channel: input.channel,
        status: initialStatus,
        placedAt,
        businessDate,
        total: round(gross),
        grossTotal: round(gross),
        channelFeeRate: feeRate,
        channelFee,
        netTotal: net,
        source: input.source ?? null,
        fulfillment: input.fulfillment ?? null,
        tableNumber: input.tableNumber != null ? String(input.tableNumber) : null,
        customerName: input.customerName ?? null,
        customerId: input.customerId ?? null,
        updatedAt: placedAt,
        statusHistory: [{ status: initialStatus, at: placedAt.toISOString() }] as any,
        items: { create: orderItemsData },
      },
    });

    // Depletion: aggregate ingredient usage across all dishes in this order.
    const usage = new Map<string, number>();
    for (const line of input.items) {
      const mi = resolve(line)!;
      for (const rl of mi.recipeLines) {
        usage.set(rl.ingredientId, (usage.get(rl.ingredientId) ?? 0) + rl.quantity * line.quantity);
      }
    }

    const raisedAlerts: string[] = [];
    for (const [ingredientId, amount] of usage) {
      const ing = await tx.ingredient.findUnique({ where: { id: ingredientId }, include: { batches: true } });
      if (!ing) continue;

      // Deduct from oldest batch first (FIFO).
      let remaining = amount;
      const batches = ing.batches.sort((a, b) => a.arrivedAt.getTime() - b.arrivedAt.getTime());
      for (const b of batches) {
        if (remaining <= 0) break;
        const take = Math.min(b.quantity, remaining);
        await tx.batch.update({ where: { batchId: b.batchId }, data: { quantity: b.quantity - take } });
        remaining -= take;
      }

      const newStock = ing.batches.reduce((s, b) => s + b.quantity, 0) - amount;
      await tx.movement.create({
        data: {
          id: await nextMovementId(tx),
          ingredientId,
          ingredientName: ing.name,
          change: -amount,
          unit: ing.unit,
          reason: 'sale',
          orderId,
          timestamp: placedAt,
          businessDate,
          balanceAfter: round(Math.max(0, newStock)),
          note: `Depletion from ${orderId}`,
        },
      });

      // Low-stock alert: raise if we cross below the reorder point and none is active.
      if (newStock < ing.reorderPoint) {
        const existing = await tx.alert.findFirst({
          where: { ingredientId, type: 'LOW_STOCK', status: 'ACTIVE' },
        });
        if (!existing) {
          const alertId = await nextAlertId(tx);
          await tx.alert.create({
            data: {
              id: alertId,
              type: 'LOW_STOCK',
              status: 'ACTIVE',
              severity: newStock <= 0 ? 'critical' : 'high',
              ingredientId,
              ingredientName: ing.name,
              currentQuantity: round(Math.max(0, newStock)),
              reorderPoint: ing.reorderPoint,
              unit: ing.unit,
              message:
                newStock <= 0
                  ? `${ing.name} is out of stock.`
                  : `${ing.name} is running low (${round(Math.max(0, newStock))}${ing.unit} left, reorder at ${ing.reorderPoint}).`,
              createdAt: placedAt,
            },
          });
          raisedAlerts.push(alertId);
        }
      }

      // Essential auto-86: if this ingredient just hit zero, mark every dish
      // where it is ESSENTIAL as unavailable (secondary usages are untouched —
      // the manager decides substitute / serve-without for those in Alerts).
      if (newStock <= 0) {
        const essentialLines = await tx.recipeLine.findMany({
          where: { ingredientId, essential: true },
          select: { menuItemId: true },
        });
        if (essentialLines.length) {
          await tx.menuItem.updateMany({
            where: { id: { in: essentialLines.map((l) => l.menuItemId) } },
            data: { available: false },
          });
        }
      }
    }

    return { order, raisedAlerts };
  });

  return {
    orderId: result.order.id,
    channel: result.order.channel,
    businessDate,
    gross: round(gross),
    channelFee,
    net,
    alertsRaised: result.raisedAlerts,
    // Full order doc for the customer-web contract (returned under {data} by the route).
    order: {
      id: result.order.id,
      status: result.order.status,
      createdAt: placedAt.toISOString(),
      items: orderItemsData.map((i) => ({ menuItemId: i.menuItemId, itemKey: i.itemKey, name: i.name, quantity: i.quantity, unitPrice: i.unitPrice, lineTotal: i.lineTotal })),
      total: round(gross),
      fulfillment: input.fulfillment ?? null,
      customerName: input.customerName ?? null,
      consumed: [...required.entries()].map(([ingredientId, amount]) => ({ ingredientId, amount: round(amount) })),
    },
  };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** DRY-RUN availability + inventory check for a prospective order. Writes
 *  NOTHING and charges nothing — the customer app calls this BEFORE confirming
 *  so it can warn "X just sold out" instead of failing at payment. Mirrors the
 *  checks ingestOrder enforces (unknown item, 86'd/unavailable, insufficient
 *  stock) and returns a structured verdict. */
export async function precheckOrder(input: CanonicalOrder) {
  const refs = input.items.map((i) => (i.item_id ?? i.menuItemId)!);
  const menuItems = await prisma.menuItem.findMany({
    where: { OR: [{ key: { in: refs } }, { id: { in: refs } }] },
    include: { recipeLines: true },
  });
  const byKey = new Map(menuItems.map((m) => [m.key, m]));
  const byId = new Map(menuItems.map((m) => [m.id, m]));
  const resolve = (line: { item_id?: string; menuItemId?: string }) => {
    const ref = (line.item_id ?? line.menuItemId)!;
    return byKey.get(ref) ?? byId.get(ref);
  };

  const unknown = input.items.filter((l) => !resolve(l)).map((l) => l.item_id ?? l.menuItemId);
  const unavailable = input.items.map(resolve).filter((m) => m && !m.available).map((m) => m!.name);

  // Aggregate required ingredient usage and compare to live stock.
  const required = new Map<string, number>();
  for (const line of input.items) {
    const mi = resolve(line);
    if (!mi) continue;
    for (const rl of mi.recipeLines) required.set(rl.ingredientId, (required.get(rl.ingredientId) ?? 0) + rl.quantity * line.quantity);
  }
  const shortIngredientIds: string[] = [];
  for (const [ingredientId, amount] of required) {
    const ing = await prisma.ingredient.findUnique({ where: { id: ingredientId }, include: { batches: true } });
    const have = ing ? ing.batches.reduce((s, b) => s + b.quantity, 0) : 0;
    if (have < amount) shortIngredientIds.push(ingredientId);
  }
  const soldOut = [
    ...new Set([
      ...unavailable,
      ...input.items
        .map(resolve)
        .filter((m) => m && m.recipeLines.some((rl) => shortIngredientIds.includes(rl.ingredientId)))
        .map((m) => m!.name),
    ]),
  ];

  const ok = unknown.length === 0 && soldOut.length === 0;
  return {
    ok,
    unknownItems: unknown,
    soldOut,
    reason: unknown.length ? 'UNKNOWN_ITEM' : soldOut.length ? 'INSUFFICIENT_INVENTORY' : null,
  };
}

// --- ID helpers (keep the ORD-/MOV-/ALERT- scheme from the dataset) ---
async function nextOrderId(): Promise<string> {
  const last = await prisma.order.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
  const n = last ? parseInt(last.id.replace(/\D/g, ''), 10) + 1 : 1;
  return `ORD-${String(n).padStart(5, '0')}`;
}
async function nextMovementId(tx: any): Promise<string> {
  const last = await tx.movement.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
  const n = last ? parseInt(last.id.replace(/\D/g, ''), 10) + 1 : 1;
  return `MOV-${String(n).padStart(6, '0')}`;
}
async function nextAlertId(tx: any): Promise<string> {
  const last = await tx.alert.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
  const n = last ? parseInt(last.id.replace(/\D/g, ''), 10) + 1 : 1;
  return `ALERT-${String(n).padStart(3, '0')}`;
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// ── Order status lifecycle (customer-web contract) ──────────────────────────
// RECEIVED → PREPARING → READY → COMPLETED, with CANCELLED reachable from the
// non-terminal states. Accepts the contract's spelling variants.
const STATUS_ALIASES: Record<string, string> = {
  RECEIVED: 'RECEIVED', PENDING: 'RECEIVED', NEW: 'RECEIVED',
  PREPARING: 'PREPARING', IN_PROGRESS: 'PREPARING',
  READY: 'READY',
  COMPLETED: 'COMPLETED', PICKED_UP: 'COMPLETED', SERVED: 'COMPLETED',
  CANCELLED: 'CANCELLED', CANCELED: 'CANCELLED',
};
const ALLOWED_NEXT: Record<string, string[]> = {
  RECEIVED: ['PREPARING', 'READY', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function normalizeStatus(raw: string): string | null {
  return STATUS_ALIASES[(raw ?? '').toUpperCase().trim()] ?? null;
}

export async function transitionOrderStatus(orderId: string, rawStatus: string) {
  const next = normalizeStatus(rawStatus);
  if (!next) throw new HttpError(400, `Unknown status: ${rawStatus}`);
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new HttpError(404, 'Order not found');
  const current = normalizeStatus(order.status) ?? order.status;
  if (current === next) return order; // idempotent
  const allowed = ALLOWED_NEXT[current] ?? [];
  if (!allowed.includes(next)) {
    throw new HttpError(409, JSON.stringify({ code: 'INVALID_TRANSITION', message: `Cannot move ${current} → ${next}` }));
  }
  const now = new Date();
  const history = Array.isArray(order.statusHistory) ? (order.statusHistory as any[]) : [];
  history.push({ status: next, at: now.toISOString() });
  return prisma.order.update({
    where: { id: orderId },
    data: { status: next, updatedAt: now, statusHistory: history as any },
  });
}
