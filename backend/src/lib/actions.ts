// Alert actions + expiry scanning. All plain code — the LLM never writes here.
// These power the "do something about the alert" buttons: reorder, 86 (mark
// dependent dishes sold out), restore availability, and the expiry warnings.

import { prisma } from './prisma.js';
import { getDemoNow, getStockLevels } from './calc.js';
import { HttpError } from './orders.js';

function businessDateFor(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}
function round(n: number, dp = 2): number { const f = 10 ** dp; return Math.round(n * f) / f; }

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
async function nextBatchId(tx: any): Promise<string> {
  // Reorder batches use a dedicated RE- prefix so they never collide with the
  // seed's varied prefixes (AS-, RO-, TS-, …). Suffix counts existing RE- rows.
  const last = await tx.batch.findFirst({
    where: { batchId: { startsWith: 'RE-' } },
    orderBy: { batchId: 'desc' },
    select: { batchId: true },
  });
  const n = last ? parseInt(last.batchId.replace(/\D/g, ''), 10) + 1 : 1;
  return `RE-${String(n).padStart(5, '0')}`;
}

/** Dishes whose recipe uses a given ingredient. */
export async function dishesUsingIngredient(ingredientId: string) {
  const lines = await prisma.recipeLine.findMany({
    where: { ingredientId },
    include: { menuItem: { select: { id: true, key: true, name: true, available: true } } },
  });
  // de-dupe menu items
  const map = new Map(lines.map((l) => [l.menuItem.id, l.menuItem]));
  return [...map.values()];
}

/** Reorder: book a restock delivery for an ingredient (default = one pack, or
 *  enough to reach ~target days), resolve its low-stock alert, and restore any
 *  dishes that were 86'd solely for this ingredient. */
export async function reorderIngredient(alertId: string, qtyOverride?: number) {
  const now = await getDemoNow();
  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert) throw new HttpError(404, 'Alert not found');
  const ing = await prisma.ingredient.findUnique({ where: { id: alert.ingredientId }, include: { batches: true } });
  if (!ing) throw new HttpError(404, 'Ingredient not found');

  const current = ing.batches.reduce((s, b) => s + b.quantity, 0);
  // Default reorder qty: a pack if defined, else enough to clear the reorder point by 50%.
  const defaultQty = ing.packSize && ing.packSize > 0
    ? ing.packSize
    : Math.max(ing.reorderPoint * 1.5 - current, ing.reorderPoint);
  const qty = round(qtyOverride ?? defaultQty);
  const businessDate = businessDateFor(now);

  await prisma.$transaction(async (tx) => {
    const batchId = await nextBatchId(tx);
    const expiresAt = ing.shelfLifeDays ? new Date(now.getTime() + ing.shelfLifeDays * 86400_000) : null;
    await tx.batch.create({ data: { batchId, ingredientId: ing.id, quantity: qty, arrivedAt: now, expiresAt } });
    await tx.movement.create({
      data: {
        id: await nextMovementId(tx),
        ingredientId: ing.id, ingredientName: ing.name,
        change: qty, unit: ing.unit, reason: 'delivery',
        batchId, timestamp: now, businessDate,
        balanceAfter: round(current + qty),
        note: `Reorder booked from alert ${alertId}`,
      },
    });
    await tx.alert.update({
      where: { id: alertId },
      data: { status: 'RESOLVED', resolvedAt: now, resolution: `Reorder booked (+${qty} ${ing.unit}).` },
    });
  });

  const restored = await restoreAvailabilityForIngredient(ing.id);
  return { ingredient: ing.name, reordered: qty, unit: ing.unit, newStock: round(current + qty), dishesRestored: restored };
}

/** 86 / sold-out: mark every dish depending on the ingredient as unavailable,
 *  and resolve the alert. The customer app honors `available=false`. */
export async function eightySixDishesForAlert(alertId: string) {
  const now = await getDemoNow();
  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert) throw new HttpError(404, 'Alert not found');
  const dishes = await dishesUsingIngredient(alert.ingredientId);
  const keys = dishes.map((d) => d.key);

  await prisma.$transaction(async (tx) => {
    await tx.menuItem.updateMany({ where: { id: { in: dishes.map((d) => d.id) } }, data: { available: false } });
    await tx.alert.update({
      where: { id: alertId },
      data: { status: 'RESOLVED', resolvedAt: now, resolution: `86'd ${dishes.length} dish(es): ${dishes.map((d) => d.name).join(', ')}.` },
    });
  });
  return { ingredient: alert.ingredientName, eightySixed: dishes.map((d) => d.name), keys };
}

/** Manual availability toggle for a single dish (also used standalone). */
export async function setMenuAvailability(key: string, available: boolean) {
  const mi = await prisma.menuItem.findUnique({ where: { key } });
  if (!mi) throw new HttpError(404, 'Menu item not found');
  await prisma.menuItem.update({ where: { key }, data: { available } });
  return { key, name: mi.name, available };
}

/** Auto-restore: re-enable any dish that is currently unavailable IF every
 *  ingredient it needs is now at/above its reorder point. Called after a
 *  reorder or a manual count that brings stock back. */
export async function restoreAvailabilityForIngredient(ingredientId: string): Promise<string[]> {
  const dishes = await dishesUsingIngredient(ingredientId);
  const unavailable = dishes.filter((d) => !d.available);
  if (unavailable.length === 0) return [];

  const restored: string[] = [];
  for (const dish of unavailable) {
    const lines = await prisma.recipeLine.findMany({
      where: { menuItemId: dish.id },
      include: { ingredient: { include: { batches: true } } },
    });
    const allOk = lines.every((l) => {
      const stock = l.ingredient.batches.reduce((s, b) => s + b.quantity, 0);
      return stock >= l.ingredient.reorderPoint;
    });
    if (allOk) {
      await prisma.menuItem.update({ where: { id: dish.id }, data: { available: true } });
      restored.push(dish.name);
    }
  }
  return restored;
}

/** Expiry scan: for each batch, compute days-until-expiry against demo now.
 *  <= 0 days  -> critical "DO NOT USE" (also zero out the batch so it stops
 *               counting as usable stock and raise/keep an EXPIRY alert).
 *  1..7 days  -> warning alert, severity escalating as the day nears.
 *  Idempotent: re-running updates existing EXPIRY alerts instead of duplicating. */
export async function scanExpiries() {
  const now = await getDemoNow();
  const businessDate = businessDateFor(now);
  const horizon = new Date(now.getTime() + 7 * 86400_000);

  const batches = await prisma.batch.findMany({
    where: { expiresAt: { not: null, lte: horizon }, quantity: { gt: 0 } },
    include: { ingredient: true },
  });

  const touched: { ingredient: string; daysLeft: number; severity: string; doNotUse: boolean }[] = [];

  for (const b of batches) {
    if (!b.expiresAt) continue;
    const msLeft = b.expiresAt.getTime() - now.getTime();
    const daysLeft = Math.ceil(msLeft / 86400_000);
    const doNotUse = daysLeft <= 0;
    const severity = doNotUse ? 'critical' : daysLeft <= 1 ? 'high' : daysLeft <= 3 ? 'medium' : 'low';

    const message = doNotUse
      ? `${b.ingredient.name} batch ${b.batchId} has EXPIRED — do not use (${b.quantity}${b.ingredient.unit} written off).`
      : `${b.ingredient.name} batch ${b.batchId} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} (${b.quantity}${b.ingredient.unit}).`;

    await prisma.$transaction(async (tx) => {
      // One EXPIRY alert per batch — keyed by including the batchId in the id-less lookup via message/ingredient.
      const existing = await tx.alert.findFirst({
        where: { type: 'EXPIRY', status: 'ACTIVE', ingredientId: b.ingredientId, note: b.batchId } as any,
      }).catch(() => null);

      if (doNotUse) {
        // Write off the expired batch so it no longer counts as usable stock.
        await tx.movement.create({
          data: {
            id: await nextMovementId(tx),
            ingredientId: b.ingredientId, ingredientName: b.ingredient.name,
            change: -b.quantity, unit: b.ingredient.unit, reason: 'spoilage',
            batchId: b.batchId, timestamp: now, businessDate,
            balanceAfter: null, note: `Expired write-off ${b.batchId}`,
          },
        });
        await tx.batch.update({ where: { batchId: b.batchId }, data: { quantity: 0 } });
      }

      if (existing) {
        await tx.alert.update({
          where: { id: existing.id },
          data: { severity, message, currentQuantity: b.quantity, updatedAt: now, status: doNotUse ? 'ACTIVE' : 'ACTIVE' },
        });
      } else {
        await tx.alert.create({
          data: {
            id: await nextAlertId(tx),
            type: 'EXPIRY', status: 'ACTIVE', severity,
            ingredientId: b.ingredientId, ingredientName: b.ingredient.name,
            currentQuantity: b.quantity, reorderPoint: b.ingredient.reorderPoint, unit: b.ingredient.unit,
            message, note: b.batchId, createdAt: now,
          },
        });
      }
    });

    touched.push({ ingredient: b.ingredient.name, daysLeft, severity, doNotUse });
  }

  return { scanned: batches.length, alerts: touched };
}


// ------------------------------------------------------------------
// Shopping cart (reorder list). Reorder adds a pending line here; placing the
// cart books the restock deliveries (reusing reorder logic per line).
// ------------------------------------------------------------------

/** Add an ingredient to the shopping cart from an alert (does NOT restock yet). */
export async function addToCart(alertId: string, qtyOverride?: number) {
  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert) throw new HttpError(404, 'Alert not found');
  const ing = await prisma.ingredient.findUnique({ where: { id: alert.ingredientId }, include: { batches: true } });
  if (!ing) throw new HttpError(404, 'Ingredient not found');
  const current = ing.batches.reduce((s, b) => s + b.quantity, 0);
  // Default reorder: enough to clear reorder point by 50%, rounded UP to whole
  // packages so the cart shows a clean "N cases" rather than a fraction.
  const need = Math.max(ing.reorderPoint * 1.5 - current, ing.reorderPoint);
  let qty: number;
  if (qtyOverride != null) {
    qty = round(qtyOverride);
  } else if (ing.packSize && ing.packSize > 1) {
    const packs = Math.max(1, Math.ceil(need / ing.packSize));
    qty = round(packs * ing.packSize);
  } else {
    qty = round(need);
  }

  await prisma.shoppingCartItem.upsert({
    where: { ingredientId: ing.id },
    create: { ingredientId: ing.id, ingredientName: ing.name, quantity: qty, unit: ing.unit, status: 'pending', sourceAlertId: alertId },
    update: { quantity: qty, status: 'pending', sourceAlertId: alertId },
  });
  return { addedToCart: ing.name, quantity: qty, unit: ing.unit };
}

/** Add an ingredient to the cart directly (not alert-bound) — used by push-to-
 *  cart from Close Day / AI suggestions. Defaults to a whole-package reorder. */
export async function addIngredientToCart(ingredientId: string, qtyOverride?: number) {
  const ing = await prisma.ingredient.findUnique({ where: { id: ingredientId }, include: { batches: true } });
  if (!ing) throw new HttpError(404, 'Ingredient not found');
  const current = ing.batches.reduce((s, b) => s + b.quantity, 0);
  const need = Math.max(ing.reorderPoint * 1.5 - current, ing.reorderPoint);
  let qty: number;
  if (qtyOverride != null) qty = round(qtyOverride);
  else if (ing.packSize && ing.packSize > 1) qty = round(Math.max(1, Math.ceil(need / ing.packSize)) * ing.packSize);
  else qty = round(need);
  await prisma.shoppingCartItem.upsert({
    where: { ingredientId: ing.id },
    create: { ingredientId: ing.id, ingredientName: ing.name, quantity: qty, unit: ing.unit, status: 'pending' },
    update: { quantity: qty, status: 'pending' },
  });
  return { addedToCart: ing.name, quantity: qty, unit: ing.unit };
}

/** Push every currently low/out ingredient into the cart (whole-package qty).
 *  Used by the 'add suggestions to cart' buttons on Close Day / Dashboard. */
export async function addLowStockToCart() {
  const stock = await getStockLevels();
  const low = stock.filter((s) => s.status === 'low' || s.status === 'out');
  const added: string[] = [];
  for (const s of low) {
    await addIngredientToCart(s.id).catch(() => {});
    added.push(s.name);
  }
  return { added: added.length, items: added };
}

export async function getCart() {
  const items = await prisma.shoppingCartItem.findMany({ orderBy: { addedAt: 'asc' } });
  const ings = await prisma.ingredient.findMany({
    where: { id: { in: items.map((i) => i.ingredientId) } },
    select: { id: true, packSize: true, packLabel: true },
  });
  const packMap = new Map(ings.map((i) => [i.id, i]));
  const enriched = items.map((it) => ({
    ...it,
    packSize: packMap.get(it.ingredientId)?.packSize ?? null,
    packLabel: packMap.get(it.ingredientId)?.packLabel ?? null,
  }));
  return { items: enriched, count: enriched.length };
}

export async function removeFromCart(ingredientId: string) {
  await prisma.shoppingCartItem.deleteMany({ where: { ingredientId } });
  return { removed: ingredientId };
}

export async function setCartQuantity(ingredientId: string, quantity: number) {
  const item = await prisma.shoppingCartItem.update({ where: { ingredientId }, data: { quantity: round(quantity) } });
  return item;
}

/** Place the whole cart: book a restock delivery per line, resolve any linked
 *  alert, restore availability, then clear the cart. */
export async function placeCart() {
  const now = await getDemoNow();
  const businessDate = businessDateFor(now);
  const items = await prisma.shoppingCartItem.findMany();
  const placed: { ingredient: string; quantity: number; unit: string }[] = [];

  for (const item of items) {
    const ing = await prisma.ingredient.findUnique({ where: { id: item.ingredientId }, include: { batches: true } });
    if (!ing) continue;
    const current = ing.batches.reduce((s, b) => s + b.quantity, 0);
    await prisma.$transaction(async (tx) => {
      const batchId = await nextBatchId(tx);
      const expiresAt = ing.shelfLifeDays ? new Date(now.getTime() + ing.shelfLifeDays * 86400_000) : null;
      await tx.batch.create({ data: { batchId, ingredientId: ing.id, quantity: item.quantity, arrivedAt: now, expiresAt } });
      await tx.movement.create({
        data: {
          id: await nextMovementId(tx),
          ingredientId: ing.id, ingredientName: ing.name,
          change: item.quantity, unit: ing.unit, reason: 'delivery',
          batchId, timestamp: now, businessDate,
          balanceAfter: round(current + item.quantity),
          note: `Cart order placed`,
        },
      });
      if (item.sourceAlertId) {
        await tx.alert.updateMany({
          where: { id: item.sourceAlertId, status: 'ACTIVE' },
          data: { status: 'RESOLVED', resolvedAt: now, resolution: `Restocked via cart (+${item.quantity} ${ing.unit}).` },
        });
      }
    });
    await restoreAvailabilityForIngredient(ing.id);
    placed.push({ ingredient: ing.name, quantity: item.quantity, unit: ing.unit });
  }
  await prisma.shoppingCartItem.deleteMany({});
  return { placed, count: placed.length };
}

// ------------------------------------------------------------------
// Essential vs secondary handling.
// ------------------------------------------------------------------

/** Classify an ingredient's role for the dependent dishes: is it ESSENTIAL to
 *  any of them (→ auto-86 on stockout) or only SECONDARY everywhere (→ manager
 *  gets substitute / serve-without choices)? */
export async function classifyIngredientForAlert(alertId: string) {
  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert) throw new HttpError(404, 'Alert not found');
  const lines = await prisma.recipeLine.findMany({
    where: { ingredientId: alert.ingredientId },
    include: { menuItem: { select: { key: true, name: true, available: true } } },
  });
  const essentialDishes = lines.filter((l) => l.essential).map((l) => l.menuItem.name);
  const secondaryDishes = lines.filter((l) => !l.essential).map((l) => l.menuItem.name);
  return {
    ingredient: alert.ingredientName,
    isEssentialSomewhere: essentialDishes.length > 0,
    essentialDishes,
    secondaryDishes,
  };
}

/** Serve WITHOUT the ingredient: for every dish where this ingredient is
 *  SECONDARY, drop the recipe line so depletion skips it and the dish stays
 *  sellable. Essential dishes are left alone (they can't be served without it).
 *  Resolves the alert. */
export async function serveWithoutIngredient(alertId: string) {
  const now = await getDemoNow();
  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert) throw new HttpError(404, 'Alert not found');
  const lines = await prisma.recipeLine.findMany({
    where: { ingredientId: alert.ingredientId, essential: false },
    include: { menuItem: { select: { id: true, name: true } } },
  });
  const dishNames = [...new Set(lines.map((l) => l.menuItem.name))];
  await prisma.$transaction(async (tx) => {
    await tx.recipeLine.deleteMany({ where: { ingredientId: alert.ingredientId, essential: false } });
    await tx.alert.update({
      where: { id: alertId },
      data: { status: 'RESOLVED', resolvedAt: now, resolution: `Serving without ${alert.ingredientName} on: ${dishNames.join(', ') || 'affected dishes'}.` },
    });
  });
  return { ingredient: alert.ingredientName, servedWithoutOn: dishNames };
}

/** Substitute the out ingredient with another in-stock ingredient for every
 *  SECONDARY usage: repoint those recipe lines to the substitute. Resolves the
 *  alert. The substitute must exist and have stock. */
export async function substituteIngredient(alertId: string, substituteId: string) {
  const now = await getDemoNow();
  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert) throw new HttpError(404, 'Alert not found');
  const sub = await prisma.ingredient.findUnique({ where: { id: substituteId }, include: { batches: true } });
  if (!sub) throw new HttpError(404, 'Substitute ingredient not found');
  const subStock = sub.batches.reduce((s, b) => s + b.quantity, 0);
  if (subStock <= 0) throw new HttpError(400, `${sub.name} has no stock to substitute with.`);

  const lines = await prisma.recipeLine.findMany({
    where: { ingredientId: alert.ingredientId, essential: false },
    include: { menuItem: { select: { id: true, name: true } } },
  });
  const dishNames = [...new Set(lines.map((l) => l.menuItem.name))];

  await prisma.$transaction(async (tx) => {
    for (const l of lines) {
      // Repoint the line to the substitute, guarding the unique (menuItem, ingredient) constraint.
      const clash = await tx.recipeLine.findFirst({ where: { menuItemId: l.menuItemId, ingredientId: substituteId } });
      if (clash) { await tx.recipeLine.delete({ where: { id: l.id } }); }
      else { await tx.recipeLine.update({ where: { id: l.id }, data: { ingredientId: substituteId } }); }
    }
    await tx.alert.update({
      where: { id: alertId },
      data: { status: 'RESOLVED', resolvedAt: now, resolution: `Substituted ${alert.ingredientName} → ${sub.name} on: ${dishNames.join(', ') || 'affected dishes'}.` },
    });
  });
  return { from: alert.ingredientName, to: sub.name, dishes: dishNames };
}

/** In-stock ingredients the manager could pick as a substitute (same category
 *  first, then any with stock). */
export async function substituteOptionsFor(alertId: string) {
  const alert = await prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert) throw new HttpError(404, 'Alert not found');
  const stock = await getStockLevels();
  const target = stock.find((s) => s.id === alert.ingredientId);
  const inStock = stock.filter((s) => s.id !== alert.ingredientId && s.currentStock > 0);
  // same category first
  inStock.sort((a, b) => {
    const ac = a.category === target?.category ? 0 : 1;
    const bc = b.category === target?.category ? 0 : 1;
    return ac - bc || a.name.localeCompare(b.name);
  });
  return inStock.map((s) => ({ id: s.id, name: s.name, category: s.category, currentStock: s.currentStock, unit: s.unit }));
}
