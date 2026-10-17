// Deterministic math for the whole manager side. Per the PRD: plain code computes
// every number here. The LLM (ai.ts) only phrases facts this module produces.

import { prisma } from './prisma.js';

export type ChannelFeeRate = Record<string, number>;

// Channel commission assumptions (demo). Used for gross-vs-net insight.
export const CHANNEL_FEE_RATES: ChannelFeeRate = {
  dine_in: 0,
  takeout: 0,
  website: 0,
  barmade: 0.1,
  uber_eats: 0.3,
  doordash: 0.25,
};

export interface IngredientStock {
  id: string;
  name: string;
  category: string;
  unit: string;
  currentStock: number;
  reorderPoint: number;
  targetDays: number | null;
  avgDailyUsage: number; // over the lookback window
  daysOfCover: number | null; // currentStock / avgDailyUsage
  status: 'ok' | 'low' | 'out' | 'overstock';
  packSize: number | null;
  packLabel: string | null;
}

/** Current estimated stock per ingredient = sum of batch quantities (authoritative in seed),
 *  reconciled with the latest balance_after movement when available. */
export async function getStockLevels(lookbackDays = 14): Promise<IngredientStock[]> {
  const ingredients = await prisma.ingredient.findMany({
    include: { batches: true },
  });

  const now = await getDemoNow();
  const since = new Date(now.getTime() - lookbackDays * 86400_000);

  // Average daily consumption (negative movements only) over the lookback window.
  const usage = await prisma.movement.groupBy({
    by: ['ingredientId'],
    where: { change: { lt: 0 }, timestamp: { gte: since } },
    _sum: { change: true },
  });
  const usageMap = new Map(usage.map((u) => [u.ingredientId, Math.abs(u._sum.change ?? 0)]));

  return ingredients.map((ing) => {
    const currentStock = ing.batches.reduce((s, b) => s + b.quantity, 0);
    const totalUsed = usageMap.get(ing.id) ?? 0;
    const avgDailyUsage = totalUsed / lookbackDays;
    const daysOfCover = avgDailyUsage > 0 ? currentStock / avgDailyUsage : null;

    let status: IngredientStock['status'] = 'ok';
    if (currentStock <= 0) status = 'out';
    else if (currentStock < ing.reorderPoint) status = 'low';
    else if (
      ing.targetDays &&
      daysOfCover !== null &&
      daysOfCover > ing.targetDays * 1.8
    )
      status = 'overstock';

    return {
      id: ing.id,
      name: ing.name,
      category: ing.category,
      unit: ing.unit,
      currentStock: round(currentStock),
      reorderPoint: ing.reorderPoint,
      targetDays: ing.targetDays,
      avgDailyUsage: round(avgDailyUsage),
      daysOfCover: daysOfCover === null ? null : round(daysOfCover, 1),
      status,
      packSize: ing.packSize ?? null,
      packLabel: ing.packLabel ?? null,
    };
  });
}

/** Servings remaining for each menu item: limited by its scarcest ingredient. */
export async function getServingsRemaining() {
  const [items, stock] = await Promise.all([
    prisma.menuItem.findMany({ include: { recipeLines: true } }),
    getStockLevels(),
  ]);
  const stockMap = new Map(stock.map((s) => [s.id, s]));

  return items.map((item) => {
    let limit = Infinity;
    let constraint: { ingredientId: string; name: string } | null = null;
    for (const line of item.recipeLines) {
      const s = stockMap.get(line.ingredientId);
      if (!s || line.quantity <= 0) continue;
      const possible = Math.floor(s.currentStock / line.quantity);
      if (possible < limit) {
        limit = possible;
        constraint = { ingredientId: line.ingredientId, name: s.name };
      }
    }
    return {
      menuItemId: item.id,
      key: item.key,
      name: item.name,
      servingsRemaining: Number.isFinite(limit) ? limit : null,
      limitingIngredient: constraint,
    };
  });
}

export interface SalesByDay {
  businessDate: string;
  orders: number;
  gross: number;
  fees: number;
  net: number;
}

/** Daily sales totals across the whole history (gross, fees, net). */
export async function getSalesByDay(): Promise<SalesByDay[]> {
  const orders = await prisma.order.findMany({
    select: { businessDate: true, grossTotal: true, channelFee: true, netTotal: true },
  });
  const map = new Map<string, SalesByDay>();
  for (const o of orders) {
    const row = map.get(o.businessDate) ?? {
      businessDate: o.businessDate,
      orders: 0,
      gross: 0,
      fees: 0,
      net: 0,
    };
    row.orders += 1;
    row.gross += o.grossTotal;
    row.fees += o.channelFee;
    row.net += o.netTotal;
    map.set(o.businessDate, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, gross: round(r.gross), fees: round(r.fees), net: round(r.net) }))
    .sort((a, b) => a.businessDate.localeCompare(b.businessDate));
}

/** Quantity + revenue per dish, optionally scoped to one business date. */
export async function getSalesByDish(businessDate?: string) {
  const items = await prisma.orderItem.findMany({
    where: businessDate ? { order: { businessDate } } : undefined,
    select: { itemKey: true, name: true, quantity: true, lineTotal: true },
  });
  const map = new Map<string, { key: string; name: string; qty: number; revenue: number }>();
  for (const it of items) {
    const row = map.get(it.itemKey) ?? { key: it.itemKey, name: it.name, qty: 0, revenue: 0 };
    row.qty += it.quantity;
    row.revenue += it.lineTotal;
    map.set(it.itemKey, row);
  }
  return [...map.values()]
    .map((r) => ({ ...r, revenue: round(r.revenue) }))
    .sort((a, b) => b.qty - a.qty);
}

/** Revenue, fees and net split by channel (gross-vs-net insight). */
export async function getChannelMix(businessDate?: string) {
  const orders = await prisma.order.findMany({
    where: businessDate ? { businessDate } : undefined,
    select: { channel: true, grossTotal: true, channelFee: true, netTotal: true },
  });
  const map = new Map<string, { channel: string; orders: number; gross: number; fees: number; net: number }>();
  for (const o of orders) {
    const row = map.get(o.channel) ?? { channel: o.channel, orders: 0, gross: 0, fees: 0, net: 0 };
    row.orders += 1;
    row.gross += o.grossTotal;
    row.fees += o.channelFee;
    row.net += o.netTotal;
    map.set(o.channel, row);
  }
  return [...map.values()]
    .map((r) => ({
      ...r,
      gross: round(r.gross),
      fees: round(r.fees),
      net: round(r.net),
      feePct: r.gross > 0 ? round((r.fees / r.gross) * 100, 1) : 0,
    }))
    .sort((a, b) => b.gross - a.gross);
}

/** Overstock specials: ingredients with high days-of-cover and the dishes that use them. */
export async function getOverstockSpecials() {
  const [stock, items] = await Promise.all([
    getStockLevels(),
    prisma.menuItem.findMany({ include: { recipeLines: true } }),
  ]);
  const overstocked = stock.filter((s) => s.status === 'overstock' && s.daysOfCover);
  return overstocked.map((ing) => {
    const dishes = items
      .filter((it) => it.recipeLines.some((l) => l.ingredientId === ing.id))
      .map((it) => it.name);
    return {
      ingredientId: ing.id,
      ingredient: ing.name,
      daysOfCover: ing.daysOfCover,
      targetDays: ing.targetDays,
      suggestedDishes: dishes,
      reason: `${ing.name} has ${ing.daysOfCover} days of cover vs a ${ing.targetDays}-day target. Push a special on: ${dishes.join(', ') || 'dishes using it'}.`,
    };
  });
}

/** The structured, computed facts handed to the LLM for the end-of-day summary. */
export async function getCloseDayFacts(businessDate: string) {
  const [dishes, channels, stock, overstock, activeAlerts] = await Promise.all([
    getSalesByDish(businessDate),
    getChannelMix(businessDate),
    getStockLevels(),
    getOverstockSpecials(),
    prisma.alert.findMany({ where: { status: 'ACTIVE' } }),
  ]);
  const totalGross = channels.reduce((s, c) => s + c.gross, 0);
  const totalNet = channels.reduce((s, c) => s + c.net, 0);
  const orderCount = channels.reduce((s, c) => s + c.orders, 0);
  return {
    businessDate,
    orders: orderCount,
    grossRevenue: round(totalGross),
    netRevenue: round(totalNet),
    totalFees: round(totalGross - totalNet),
    topDishes: dishes.slice(0, 5),
    bottomDishes: dishes.slice(-3).reverse(),
    channelMix: channels,
    lowOrOutIngredients: stock.filter((s) => s.status === 'low' || s.status === 'out'),
    overstockSpecials: overstock,
    activeAlerts: activeAlerts.map((a) => ({
      type: a.type,
      severity: a.severity,
      ingredient: a.ingredientName,
      message: a.message,
    })),
  };
}

/** Demo "now" — the venue-local end of the CURRENT business day. Driven by the
 *  SystemState cursor so Close Day can advance it; falls back to the latest
 *  movement when the cursor is unset. Cached per process; cleared on advance. */
let cachedNow: Date | null = null;
export async function getDemoNow(): Promise<Date> {
  if (cachedNow) return cachedNow;
  const state = await prisma.systemState.findUnique({ where: { id: 'singleton' } });
  if (state?.currentDay) {
    // End-of-day instant (23:30 local) so "today" math includes the whole day.
    cachedNow = new Date(`${state.currentDay}T23:30:00-04:00`);
    return cachedNow;
  }
  const last = await prisma.movement.findFirst({ orderBy: { timestamp: 'desc' }, select: { timestamp: true } });
  cachedNow = last?.timestamp ?? new Date();
  return cachedNow;
}

/** The current business day string (YYYY-MM-DD). */
export async function getCurrentDay(): Promise<string> {
  const state = await prisma.systemState.findUnique({ where: { id: 'singleton' } });
  if (state?.currentDay) return state.currentDay;
  const now = await getDemoNow();
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Advance the business-day cursor by one day (called by Close Day). Clears the
 *  cached now so subsequent reads reflect the new day. Returns the new day. */
export async function advanceDay(): Promise<string> {
  const current = await getCurrentDay();
  const next = new Date(`${current}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const nextDay = next.toISOString().slice(0, 10);
  await prisma.systemState.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', currentDay: nextDay, closed: true },
    update: { currentDay: nextDay, closed: true, updatedAt: new Date() },
  });
  cachedNow = null; // force re-read on next getDemoNow
  return nextDay;
}

/** Reopen for business on the CURRENT day. Close Day already advanced the
 *  cursor forward to a fresh day; opening simply marks the restaurant open
 *  again (no cursor change), so a newly-opened day starts with 0 orders until a
 *  customer places one. */
export async function openDay(): Promise<string> {
  const current = await getCurrentDay();
  await prisma.systemState.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', currentDay: current, closed: false },
    update: { closed: false, updatedAt: new Date() },
  });
  cachedNow = null;
  return current;
}

/** Whether the restaurant is currently closed (customer app stops taking orders). */
export async function getRestaurantClosed(): Promise<boolean> {
  const state = await prisma.systemState.findUnique({ where: { id: 'singleton' } });
  return !!state?.closed;
}

/** Open or close the restaurant WITHOUT moving the day cursor. Closing here is
 *  the "we're closed now" switch; the customer app reads it from /api/status. */
export async function setRestaurantClosed(closed: boolean): Promise<boolean> {
  const current = await getCurrentDay();
  await prisma.systemState.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', currentDay: current, closed },
    update: { closed, updatedAt: new Date() },
  });
  return closed;
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}


/** Detailed status for ONE dish: its recipe joined with live stock, how many
 *  servings each ingredient supports, the scarcest (limiting) ingredient, and a
 *  dish-level status derived from availability + servings. Powers the dashboard
 *  dish drill-down. */
export async function getDishStatus(key: string) {
  const item = await prisma.menuItem.findUnique({ where: { key }, include: { recipeLines: true } });
  if (!item) return null;
  const stock = await getStockLevels();
  const stockMap = new Map(stock.map((s) => [s.id, s]));

  let servings = Infinity;
  const ingredients = item.recipeLines.map((line) => {
    const s = stockMap.get(line.ingredientId);
    const onHand = s?.currentStock ?? 0;
    const perServing = line.quantity;
    const possible = perServing > 0 ? Math.floor(onHand / perServing) : Infinity;
    if (possible < servings) servings = possible;
    return {
      ingredientId: line.ingredientId,
      name: s?.name ?? line.ingredientId,
      unit: s?.unit ?? '',
      perServing,
      onHand: round(onHand),
      servingsPossible: Number.isFinite(possible) ? possible : null,
      status: s?.status ?? 'ok',
    };
  }).sort((a, b) => (a.servingsPossible ?? Infinity) - (b.servingsPossible ?? Infinity));

  const servingsRemaining = Number.isFinite(servings) ? servings : null;
  const limiting = ingredients[0] ?? null;
  // Dish status: sold out if manually 86'd or zero servings; attention if < 10 servings; else safe.
  let dishStatus: 'sold_out' | 'attention' | 'safe';
  if (!item.available || servingsRemaining === 0) dishStatus = 'sold_out';
  else if (servingsRemaining !== null && servingsRemaining < 10) dishStatus = 'attention';
  else dishStatus = 'safe';

  return {
    key: item.key,
    name: item.name,
    category: item.category,
    available: item.available,
    servingsRemaining,
    status: dishStatus,
    limitingIngredient: limiting ? { name: limiting.name, servingsPossible: limiting.servingsPossible } : null,
    ingredients,
  };
}

/** Status for ALL dishes (list view on the dashboard). */
export async function getAllDishStatuses() {
  const items = await prisma.menuItem.findMany({ include: { recipeLines: true } });
  const stock = await getStockLevels();
  const stockMap = new Map(stock.map((s) => [s.id, s]));

  return items.map((item) => {
    let servings = Infinity;
    let limiting: { name: string; servingsPossible: number } | null = null;
    for (const line of item.recipeLines) {
      const s = stockMap.get(line.ingredientId);
      const onHand = s?.currentStock ?? 0;
      const possible = line.quantity > 0 ? Math.floor(onHand / line.quantity) : Infinity;
      if (possible < servings) { servings = possible; limiting = { name: s?.name ?? line.ingredientId, servingsPossible: Number.isFinite(possible) ? possible : 0 }; }
    }
    const servingsRemaining = Number.isFinite(servings) ? servings : null;
    let status: 'sold_out' | 'attention' | 'safe';
    if (!item.available || servingsRemaining === 0) status = 'sold_out';
    else if (servingsRemaining !== null && servingsRemaining < 10) status = 'attention';
    else status = 'safe';
    return { key: item.key, name: item.name, category: item.category, available: item.available, servingsRemaining, status, limitingIngredient: limiting };
  }).sort((a, b) => {
    const rank = { sold_out: 0, attention: 1, safe: 2 };
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    return (a.servingsRemaining ?? 0) - (b.servingsRemaining ?? 0);
  });
}


/** Inventory expectation vs actual, for a business date. For each ingredient:
 *  - expected = sum over dishes sold that day of (recipe qty * quantity sold)
 *  - actual   = sum of that day's `sale` movements (what really left stock)
 *  - variance = actual - expected (negative = used LESS than expected; positive
 *               = used MORE than the recipes predict → waste, over-portioning,
 *               spillage, or untracked usage).
 *  This is the backward-looking reconciliation: "we expected to use X, we used Y". */
export async function getProjectionForDate(businessDate: string) {
  const [soldItems, saleMovements, ingredients, menu] = await Promise.all([
    prisma.orderItem.findMany({
      where: { order: { businessDate } },
      select: { itemKey: true, quantity: true },
    }),
    prisma.movement.groupBy({
      by: ['ingredientId'],
      where: { businessDate, reason: 'sale' },
      _sum: { change: true },
    }),
    prisma.ingredient.findMany({ select: { id: true, name: true, unit: true, category: true } }),
    prisma.menuItem.findMany({ include: { recipeLines: true } }),
  ]);

  const ingMap = new Map(ingredients.map((i) => [i.id, i]));
  const recipeByKey = new Map(menu.map((m) => [m.key, m.recipeLines]));

  // Expected usage per ingredient from dishes sold.
  const expected = new Map<string, number>();
  let dishesSold = 0;
  for (const it of soldItems) {
    dishesSold += it.quantity;
    const lines = recipeByKey.get(it.itemKey);
    if (!lines) continue;
    for (const l of lines) {
      expected.set(l.ingredientId, (expected.get(l.ingredientId) ?? 0) + l.quantity * it.quantity);
    }
  }

  // Actual usage per ingredient (sale movements are negative; take absolute).
  const actual = new Map<string, number>();
  for (const m of saleMovements) actual.set(m.ingredientId, Math.abs(m._sum.change ?? 0));

  // Union of ingredients that appear on either side.
  const ids = new Set<string>([...expected.keys(), ...actual.keys()]);
  const rows = [...ids].map((id) => {
    const ing = ingMap.get(id);
    const exp = round(expected.get(id) ?? 0);
    const act = round(actual.get(id) ?? 0);
    const variance = round(act - exp);
    const variancePct = exp > 0 ? round((variance / exp) * 100, 1) : null;
    return {
      ingredientId: id,
      name: ing?.name ?? id,
      unit: ing?.unit ?? '',
      category: ing?.category ?? '',
      expected: exp,
      actual: act,
      variance,
      variancePct,
    };
  }).sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));

  const totalExpected = round([...expected.values()].reduce((s, v) => s + v, 0));
  const totalActual = round([...actual.values()].reduce((s, v) => s + v, 0));

  return {
    businessDate,
    dishesSold,
    ingredientCount: rows.length,
    totalExpected,
    totalActual,
    rows,
  };
}


/** Per-ITEM projection: expected vs actual units sold for a business date.
 *  Expected is each dish's historical share of daily volume applied to the
 *  projected day total (the trailing average daily order volume). Actual is
 *  what sold that day. This recalibrates automatically as live orders arrive.
 *  Returned sorted by actual desc so the chart leads with the big sellers. */
export async function getItemProjectionForDate(businessDate: string) {
  // All-time per-dish totals (historical mix) + how many business days of history.
  const allItems = await prisma.orderItem.findMany({ select: { itemKey: true, name: true, quantity: true, order: { select: { businessDate: true } } } });

  const historyDays = new Set<string>();
  const allByDish = new Map<string, { key: string; name: string; qty: number }>();
  let grandTotal = 0;
  for (const it of allItems) {
    historyDays.add(it.order.businessDate);
    const row = allByDish.get(it.itemKey) ?? { key: it.itemKey, name: it.name, qty: 0 };
    row.qty += it.quantity;
    grandTotal += it.quantity;
    allByDish.set(it.itemKey, row);
  }
  const nDays = Math.max(historyDays.size, 1);
  const projectedDayTotal = grandTotal / nDays; // avg units sold per day

  // Actual sold on the target date.
  const todayItems = await prisma.orderItem.findMany({
    where: { order: { businessDate } },
    select: { itemKey: true, name: true, quantity: true },
  });
  const actualByDish = new Map<string, number>();
  for (const it of todayItems) actualByDish.set(it.itemKey, (actualByDish.get(it.itemKey) ?? 0) + it.quantity);

  const rows = [...allByDish.values()].map((d) => {
    const share = grandTotal > 0 ? d.qty / grandTotal : 0;
    const expected = Math.round(projectedDayTotal * share);
    const actual = actualByDish.get(d.key) ?? 0;
    return { key: d.key, name: d.name, expected, actual, variance: actual - expected };
  }).sort((a, b) => b.actual - a.actual);

  return {
    businessDate,
    projectedDayTotal: Math.round(projectedDayTotal),
    actualTotal: [...actualByDish.values()].reduce((s, v) => s + v, 0),
    historyDays: nDays,
    rows,
  };
}
