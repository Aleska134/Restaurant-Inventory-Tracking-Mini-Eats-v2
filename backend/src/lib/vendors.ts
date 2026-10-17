// Vendors + purchase orders. Weekly-demand sizing, vendor comparison, PO email
// generation, and receiving (which restocks). Plain code; the AI only phrases
// the email body via ai.ts (optional).

import { prisma } from './prisma.js';
import { getStockLevels, getDemoNow } from './calc.js';
import { HttpError } from './orders.js';

function round(n: number, dp = 2): number { const f = 10 ** dp; return Math.round(n * f) / f; }

function businessDateFor(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
async function nextBatchId(tx: any): Promise<string> {
  const last = await tx.batch.findFirst({ where: { batchId: { startsWith: 'RE-' } }, orderBy: { batchId: 'desc' }, select: { batchId: true } });
  const n = last ? parseInt(last.batchId.replace(/\D/g, ''), 10) + 1 : 1;
  return `RE-${String(n).padStart(5, '0')}`;
}
async function nextMovementId(tx: any): Promise<string> {
  const last = await tx.movement.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
  const n = last ? parseInt(last.id.replace(/\D/g, ''), 10) + 1 : 1;
  return `MOV-${String(n).padStart(6, '0')}`;
}

/** Weekly-demand suggestion for an ingredient: how many PACKAGES to cover ~7
 *  days, i.e. ceil((avgDailyUsage*7 - currentStock) / packSize), floored at 1
 *  package when below the reorder point. Returns the suggested base-unit qty. */
export async function suggestWeeklyQuantity(ingredientId: string) {
  const stock = await getStockLevels();
  const s = stock.find((x) => x.id === ingredientId);
  if (!s) throw new HttpError(404, 'Ingredient not found');
  const packSize = s.packSize && s.packSize > 0 ? s.packSize : 1;

  // Par level to hold = enough to cover ~7 days of usage, but never below the
  // reorder point. We order the TOP-UP from current stock to that par (not a
  // full week stacked on top of what we already have).
  const weekUsage = s.avgDailyUsage * 7;
  const par = Math.max(weekUsage, s.reorderPoint);
  const deficit = Math.max(0, par - s.currentStock);
  let packs = Math.ceil(deficit / packSize);
  // Always order at least one package when we are at/below the reorder point.
  if (packs < 1 && s.currentStock < s.reorderPoint) packs = 1;
  const baseQty = round(packs * packSize);
  return {
    ingredientId,
    name: s.name,
    unit: s.unit,
    packSize,
    packLabel: s.packLabel,
    avgDailyUsage: s.avgDailyUsage,
    weekNeed: round(weekUsage),
    par: round(par),
    currentStock: s.currentStock,
    suggestedPacks: packs,
    suggestedBaseQty: baseQty,
  };
}

/** Apply weekly-demand sizing to every item currently in the cart. */
export async function applyWeeklySuggestionsToCart() {
  const items = await prisma.shoppingCartItem.findMany();
  const out: { ingredient: string; suggestedPacks: number; unit: string }[] = [];
  for (const it of items) {
    const sug = await suggestWeeklyQuantity(it.ingredientId).catch(() => null);
    if (!sug) continue;
    await prisma.shoppingCartItem.update({ where: { ingredientId: it.ingredientId }, data: { quantity: sug.suggestedBaseQty } });
    out.push({ ingredient: it.ingredientName, suggestedPacks: sug.suggestedPacks, unit: sug.packLabel ?? it.unit });
  }
  return { updated: out.length, items: out };
}

/** AI-ANALYZED weekly suggestion: gathers recent demand per cart item (last 7
 *  days usage, trend, days of cover, par baseline), asks the model to reason
 *  about the quantity, and applies the recommended packages. Returns rationales. */
export async function aiAnalyzeCartSuggestions() {
  const { analyzeReorders } = await import('./ai.js');
  const items = await prisma.shoppingCartItem.findMany();
  if (!items.length) return { updated: 0, model: 'none', items: [] };

  const stock = await getStockLevels();
  const stockById = new Map(stock.map((s) => [s.id, s]));
  const now = await getDemoNow();

  // Build the last 7 business-day strings.
  const days: string[] = [];
  for (let d = 6; d >= 0; d--) {
    const day = new Date(now.getTime() - d * 86400_000);
    days.push(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(day));
  }
  const ingIds = items.map((i) => i.ingredientId);
  // ONE grouped query for all cart ingredients across the 7-day window.
  const usageRows = await prisma.movement.groupBy({
    by: ['ingredientId', 'businessDate'],
    where: { ingredientId: { in: ingIds }, reason: 'sale', businessDate: { in: days } },
    _sum: { change: true },
  });
  const usageMap = new Map<string, Map<string, number>>();
  for (const r of usageRows) {
    if (!usageMap.has(r.ingredientId)) usageMap.set(r.ingredientId, new Map());
    usageMap.get(r.ingredientId)!.set(r.businessDate, Math.abs(r._sum.change ?? 0));
  }

  const contexts = [] as any[];
  for (const it of items) {
    const s = stockById.get(it.ingredientId);
    if (!s) continue;
    const packSize = s.packSize && s.packSize > 0 ? s.packSize : 1;
    const perDay = usageMap.get(it.ingredientId) ?? new Map();
    const last7 = days.map((d) => round(perDay.get(d) ?? 0));
    const par = Math.max(s.avgDailyUsage * 7, s.reorderPoint);
    const parPacks = Math.max(s.currentStock < s.reorderPoint ? 1 : 0, Math.ceil(Math.max(0, par - s.currentStock) / packSize));
    contexts.push({
      ingredientId: it.ingredientId, name: s.name, unit: s.unit, packLabel: s.packLabel, packSize,
      currentStock: s.currentStock, currentPacks: round(s.currentStock / packSize),
      avgDailyUsage: s.avgDailyUsage, last7DaysUsage: last7,
      reorderPoint: s.reorderPoint, parPacks,
    });
  }

  const { recommendations, model } = await analyzeReorders(contexts);
  const out: { ingredient: string; recommendedPacks: number; unit: string; rationale: string }[] = [];
  for (const rec of recommendations) {
    const ctx = contexts.find((c) => c.ingredientId === rec.ingredientId);
    if (!ctx) continue;
    const baseQty = round(rec.recommendedPacks * ctx.packSize);
    await prisma.shoppingCartItem.update({ where: { ingredientId: rec.ingredientId }, data: { quantity: baseQty } });
    out.push({ ingredient: rec.name, recommendedPacks: rec.recommendedPacks, unit: ctx.packLabel ?? ctx.unit, rationale: rec.rationale });
  }
  return { updated: out.length, model, items: out };
}

// ── Vendors ──────────────────────────────────────────────────────────────────
export async function listVendors() {
  const vendors = await prisma.vendor.findMany({ orderBy: { name: 'asc' }, include: { products: true } });
  return vendors.map((v) => ({ ...v, productCount: v.products.length }));
}
export async function addVendor(data: { name: string; email: string; phone?: string; notes?: string; relationship?: string }) {
  if (!data.name || !data.email) throw new HttpError(400, 'name and email required');
  const relationship = ['local', 'regional', 'corporate'].includes(String(data.relationship))
    ? String(data.relationship)
    : 'regional';
  return prisma.vendor.create({ data: { name: data.name, email: data.email, phone: data.phone, notes: data.notes, relationship } });
}
export async function removeVendor(id: string) {
  await prisma.vendor.delete({ where: { id } });
  return { removed: id };
}
export async function addVendorProduct(vendorId: string, ingredientId: string, pricePerPack: number) {
  const ing = await prisma.ingredient.findUnique({ where: { id: ingredientId } });
  if (!ing) throw new HttpError(404, 'Ingredient not found');
  return prisma.vendorProduct.upsert({
    where: { vendorId_ingredientId: { vendorId, ingredientId } },
    create: { vendorId, ingredientId, ingredientName: ing.name, pricePerPack: round(pricePerPack), packLabel: ing.packLabel },
    update: { pricePerPack: round(pricePerPack) },
  });
}

/** Add/update several products for a vendor in one call. Skips rows with a
 *  non-positive price or an unknown ingredient. Returns how many were saved. */
export async function addVendorProducts(vendorId: string, rows: { ingredientId: string; pricePerPack: number }[]) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) throw new HttpError(404, 'Vendor not found');
  let saved = 0;
  for (const r of rows) {
    if (!r.ingredientId || !(r.pricePerPack > 0)) continue;
    await addVendorProduct(vendorId, r.ingredientId, r.pricePerPack).then(() => { saved++; }).catch(() => {});
  }
  return { saved };
}

export async function removeVendorProduct(vendorId: string, ingredientId: string) {
  await prisma.vendorProduct.deleteMany({ where: { vendorId, ingredientId } });
  return { removed: ingredientId };
}

/** Compare vendors that can fulfil the current cart. For each vendor, how many
 *  of the cart's ingredients it carries and the total price for the cart. */
export async function compareVendorsForCart() {
  const cart = await prisma.shoppingCartItem.findMany();
  const vendors = await prisma.vendor.findMany({ include: { products: true } });
  const ingIds = cart.map((c) => c.ingredientId);
  const stock = await getStockLevels();
  const packMap = new Map(stock.map((s) => [s.id, s.packSize && s.packSize > 0 ? s.packSize : 1]));

  const results = vendors.map((v) => {
    const prodMap = new Map(v.products.map((p) => [p.ingredientId, p]));
    let total = 0; let covered = 0;
    const lines = cart.map((c) => {
      const p = prodMap.get(c.ingredientId);
      const packSize = packMap.get(c.ingredientId) ?? 1;
      const packs = Math.max(1, Math.round(c.quantity / packSize));
      if (p) { covered++; const lineTotal = round(p.pricePerPack * packs); total += lineTotal; return { ingredient: c.ingredientName, packs, pricePerPack: p.pricePerPack, lineTotal, available: true }; }
      return { ingredient: c.ingredientName, packs, pricePerPack: null, lineTotal: 0, available: false };
    });
    return { vendorId: v.id, vendorName: v.name, email: v.email, covered, totalItems: cart.length, total: round(total), lines };
  });
  // best = most covered, then cheapest
  results.sort((a, b) => (b.covered - a.covered) || (a.total - b.total));
  return { items: cart.length, vendors: results };
}

/** Place the cart with a chosen vendor: create a PurchaseOrder (status 'sent'),
 *  generate the email, and CLEAR the cart. Does NOT restock yet — stock arrives
 *  only when the manager confirms receipt (the inventory prompt). */
export async function placeOrderWithVendor(vendorId: string) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, include: { products: true } });
  if (!vendor) throw new HttpError(404, 'Vendor not found');
  const cart = await prisma.shoppingCartItem.findMany();
  if (!cart.length) throw new HttpError(400, 'Cart is empty');
  const stock = await getStockLevels();
  const packMap = new Map(stock.map((s) => [s.id, { packSize: s.packSize && s.packSize > 0 ? s.packSize : 1, unit: s.unit }]));
  const prodMap = new Map(vendor.products.map((p) => [p.ingredientId, p]));

  const items = cart.map((c) => {
    const pk = packMap.get(c.ingredientId) ?? { packSize: 1, unit: c.unit };
    const packs = Math.max(1, Math.round(c.quantity / pk.packSize));
    const p = prodMap.get(c.ingredientId);
    const pricePerPack = p?.pricePerPack ?? 0;
    return {
      ingredientId: c.ingredientId, ingredientName: c.ingredientName,
      packs, packSize: pk.packSize, unit: pk.unit, pricePerPack, lineTotal: round(pricePerPack * packs),
    };
  });
  const total = round(items.reduce((s, i) => s + i.lineTotal, 0));
  const { generateVendorOrderEmail } = await import('./ai.js');
  const { subject, body } = await generateVendorOrderEmail({
    restaurantName: RESTAURANT_NAME,
    vendorName: vendor.name,
    relationship: (['local', 'regional', 'corporate'].includes(vendor.relationship) ? vendor.relationship : 'regional') as 'local' | 'regional' | 'corporate',
    items: items.map((i) => ({ ingredientName: i.ingredientName, packs: i.packs, packSize: i.packSize, unit: i.unit, pricePerPack: i.pricePerPack, lineTotal: i.lineTotal })),
    total,
  });

  const po = await prisma.purchaseOrder.create({
    data: {
      vendorId: vendor.id, vendorName: vendor.name, status: 'sent', total,
      emailTo: vendor.email, emailSubject: subject, emailBody: body,
      items: { create: items },
    },
    include: { items: true },
  });
  await prisma.shoppingCartItem.deleteMany({});
  return po;
}

// Restaurant display name used in vendor-facing emails.
const RESTAURANT_NAME = 'Trattoria Little Italy';

export async function listPurchaseOrders() {
  return prisma.purchaseOrder.findMany({ orderBy: { createdAt: 'desc' }, include: { items: true } });
}
export async function pendingPurchaseOrders() {
  return prisma.purchaseOrder.findMany({ where: { status: 'sent' }, orderBy: { createdAt: 'desc' }, include: { items: true } });
}

/** Mark a PO received → restock each line (packs × packSize) as a delivery,
 *  resolve matching low-stock alerts, and restore dish availability. */
export async function receivePurchaseOrder(id: string) {
  const now = await getDemoNow();
  const businessDate = businessDateFor(now);
  const po = await prisma.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
  if (!po) throw new HttpError(404, 'Purchase order not found');
  if (po.status === 'received') return po;

  for (const item of po.items) {
    const baseQty = round(item.packs * item.packSize);
    const ing = await prisma.ingredient.findUnique({ where: { id: item.ingredientId }, include: { batches: true } });
    if (!ing) continue;
    const current = ing.batches.reduce((s, b) => s + b.quantity, 0);
    await prisma.$transaction(async (tx) => {
      const batchId = await nextBatchId(tx);
      const expiresAt = ing.shelfLifeDays ? new Date(now.getTime() + ing.shelfLifeDays * 86400_000) : null;
      await tx.batch.create({ data: { batchId, ingredientId: ing.id, quantity: baseQty, arrivedAt: now, expiresAt } });
      await tx.movement.create({
        data: {
          id: await nextMovementId(tx), ingredientId: ing.id, ingredientName: ing.name,
          change: baseQty, unit: ing.unit, reason: 'delivery', batchId, timestamp: now, businessDate,
          balanceAfter: round(current + baseQty), note: `Received PO ${po.id} from ${po.vendorName}`,
        },
      });
      await tx.alert.updateMany({
        where: { ingredientId: ing.id, type: 'LOW_STOCK', status: 'ACTIVE' },
        data: { status: 'RESOLVED', resolvedAt: now, resolution: `Received from ${po.vendorName}.` },
      });
    });
  }
  // Restore availability for all affected ingredients.
  const { restoreAvailabilityForIngredient } = await import('./actions.js');
  for (const item of po.items) await restoreAvailabilityForIngredient(item.ingredientId);

  return prisma.purchaseOrder.update({ where: { id }, data: { status: 'received', receivedAt: now }, include: { items: true } });
}
