import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import {
  getStockLevels,
  getServingsRemaining,
  getSalesByDay,
  getSalesByDish,
  getChannelMix,
  getOverstockSpecials,
  getCloseDayFacts,
  getDemoNow,
  getAllDishStatuses,
  getDishStatus,
  getProjectionForDate,
  getItemProjectionForDate,
  advanceDay,
  openDay,
  getRestaurantClosed,
  setRestaurantClosed,
  getCurrentDay,
} from '../lib/calc.js';
import { generateCloseDaySummary, suggestAlertSolutions, type AlertContext } from '../lib/ai.js';
import { CanonicalOrderSchema, ingestOrder, HttpError, transitionOrderStatus, precheckOrder } from '../lib/orders.js';
import {
  eightySixDishesForAlert, setMenuAvailability,
  restoreAvailabilityForIngredient, dishesUsingIngredient, scanExpiries,
  addToCart, getCart, removeFromCart, setCartQuantity, placeCart,
  classifyIngredientForAlert, serveWithoutIngredient, substituteIngredient, substituteOptionsFor,
} from '../lib/actions.js';
import {
  suggestWeeklyQuantity, applyWeeklySuggestionsToCart, aiAnalyzeCartSuggestions, listVendors, addVendor, removeVendor,
  addVendorProduct, addVendorProducts, removeVendorProduct, compareVendorsForCart, placeOrderWithVendor, listPurchaseOrders,
  pendingPurchaseOrders, receivePurchaseOrder,
} from '../lib/vendors.js';

export const api = Router();

const wrap = (fn: (req: any, res: any) => Promise<any>) => (req: any, res: any) =>
  fn(req, res).catch((e: any) => {
    if (e instanceof HttpError) {
      // HttpError messages may be a JSON string {code,message,details} (structured
      // errors like INSUFFICIENT_INVENTORY) or a plain string.
      let body: any;
      try {
        const parsed = JSON.parse(e.message);
        body = (parsed && typeof parsed === 'object' && parsed.code) ? { error: parsed } : { error: { code: 'ERROR', message: e.message } };
      } catch {
        body = { error: { code: 'ERROR', message: e.message } };
      }
      return res.status(e.status).json(body);
    }
    console.error(e);
    res.status(500).json({ error: { code: 'INTERNAL', message: e?.message ?? 'Internal error' } });
  });

api.get('/health', (_req, res) => res.json({ ok: true, db: 'postgres', orders: 'barmade-api', ai: !!process.env.OPENROUTER_API_KEY }));

// --- Dashboard overview (one call powers the top of the dashboard) ---
api.get('/overview', wrap(async (_req, res) => {
  const now = await getDemoNow();
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);

  const [stock, salesByDay, channelMix, activeAlerts, overstock] = await Promise.all([
    getStockLevels(),
    getSalesByDay(),
    getChannelMix(today),
    prisma.alert.count({ where: { status: 'ACTIVE' } }),
    getOverstockSpecials(),
  ]);
  const todayRow = salesByDay.find((d) => d.businessDate === today);
  res.json({
    demoDate: today,
    today: todayRow ?? { businessDate: today, orders: 0, gross: 0, fees: 0, net: 0 },
    channelMixToday: channelMix,
    activeAlerts,
    lowStockCount: stock.filter((s) => s.status === 'low' || s.status === 'out').length,
    overstockCount: overstock.length,
    ingredientCount: stock.length,
  });
}));

// --- Inventory ---
api.get('/inventory', wrap(async (_req, res) => res.json(await getStockLevels())));
api.get('/inventory/servings', wrap(async (_req, res) => res.json(await getServingsRemaining())));
api.get('/inventory/overstock', wrap(async (_req, res) => res.json(await getOverstockSpecials())));

api.get('/inventory/:id/movements', wrap(async (req, res) => {
  const movements = await prisma.movement.findMany({
    where: { ingredientId: req.params.id },
    orderBy: { timestamp: 'desc' },
    take: 100,
  });
  res.json(movements);
}));

// --- Manual count / inventory adjustment (requires explicit confirm) ---
api.post('/inventory/:id/count', wrap(async (req, res) => {
  const { countedQuantity, confirm, note } = req.body ?? {};
  if (typeof countedQuantity !== 'number') throw new HttpError(400, 'countedQuantity (number) required');
  if (confirm !== true) {
    // Preview the discrepancy without saving.
    const ing = await prisma.ingredient.findUnique({ where: { id: req.params.id }, include: { batches: true } });
    if (!ing) throw new HttpError(404, 'Ingredient not found');
    const estimated = ing.batches.reduce((s, b) => s + b.quantity, 0);
    return res.json({ preview: true, ingredient: ing.name, estimated, counted: countedQuantity, delta: countedQuantity - estimated });
  }
  const ing = await prisma.ingredient.findUnique({ where: { id: req.params.id }, include: { batches: true } });
  if (!ing) throw new HttpError(404, 'Ingredient not found');
  const estimated = ing.batches.reduce((s, b) => s + b.quantity, 0);
  const delta = countedQuantity - estimated;
  const now = await getDemoNow();
  const businessDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);

  await prisma.$transaction(async (tx) => {
    // Reconcile by adjusting the newest batch (or creating a count batch).
    const newest = ing.batches.sort((a, b) => b.arrivedAt.getTime() - a.arrivedAt.getTime())[0];
    if (newest) {
      await tx.batch.update({ where: { batchId: newest.batchId }, data: { quantity: Math.max(0, newest.quantity + delta) } });
    }
    const lastMov = await tx.movement.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    const n = lastMov ? parseInt(lastMov.id.replace(/\D/g, ''), 10) + 1 : 1;
    await tx.movement.create({
      data: {
        id: `MOV-${String(n).padStart(6, '0')}`,
        ingredientId: ing.id,
        ingredientName: ing.name,
        change: delta,
        unit: ing.unit,
        reason: 'manual_count',
        timestamp: now,
        businessDate,
        balanceAfter: countedQuantity,
        note: note ?? 'Manager physical count',
      },
    });
    // Resolve a low-stock alert if the count brings us back above reorder point.
    if (countedQuantity >= ing.reorderPoint) {
      await tx.alert.updateMany({
        where: { ingredientId: ing.id, type: 'LOW_STOCK', status: 'ACTIVE' },
        data: { status: 'RESOLVED', resolvedAt: now, resolution: 'Manager count above reorder point.' },
      });
    }
  });
  await restoreAvailabilityForIngredient(ing.id);
  res.json({ saved: true, ingredient: ing.name, estimated, counted: countedQuantity, delta });
}));

// --- Sales ---
api.get('/sales/by-day', wrap(async (_req, res) => res.json(await getSalesByDay())));
api.get('/sales/by-dish', wrap(async (req, res) => res.json(await getSalesByDish(req.query.date as string | undefined))));
api.get('/sales/channels', wrap(async (req, res) => res.json(await getChannelMix(req.query.date as string | undefined))));

// --- Alerts ---
api.get('/alerts', wrap(async (req, res) => {
  const status = req.query.status as string | undefined;
  res.json(await prisma.alert.findMany({ where: status ? { status } : undefined, orderBy: { createdAt: 'desc' } }));
}));
api.post('/alerts/:id/resolve', wrap(async (req, res) => {
  const now = await getDemoNow();
  const updated = await prisma.alert.update({
    where: { id: req.params.id },
    data: { status: 'RESOLVED', resolvedAt: now, resolution: req.body?.resolution ?? 'Resolved by manager.' },
  });
  res.json(updated);
}));

// Action: reorder → adds the ingredient to the shopping cart (does not restock yet).
api.post('/alerts/:id/reorder', wrap(async (req, res) => {
  const qty = typeof req.body?.quantity === 'number' ? req.body.quantity : undefined;
  res.json(await addToCart(req.params.id, qty));
}));

// Essential vs secondary classification for an alert (drives which choices show).
api.get('/alerts/:id/classify', wrap(async (req, res) => res.json(await classifyIngredientForAlert(req.params.id))));

// Secondary-ingredient choices: serve-without, substitute, and substitute options.
api.post('/alerts/:id/serve-without', wrap(async (req, res) => res.json(await serveWithoutIngredient(req.params.id))));
api.get('/alerts/:id/substitute-options', wrap(async (req, res) => res.json(await substituteOptionsFor(req.params.id))));
api.post('/alerts/:id/substitute', wrap(async (req, res) => {
  const substituteId = req.body?.substituteId;
  if (!substituteId) throw new HttpError(400, 'substituteId required');
  res.json(await substituteIngredient(req.params.id, substituteId));
}));

// Action: 86 / mark dependent dishes sold out (+ resolve).
api.post('/alerts/:id/eighty-six', wrap(async (req, res) => {
  res.json(await eightySixDishesForAlert(req.params.id));
}));

// AI batch suggestions: propose one action per active alert (apply via the routes above).
api.post('/alerts/suggest', wrap(async (_req, res) => {
  const now = await getDemoNow();
  const activeAlerts = await prisma.alert.findMany({ where: { status: 'ACTIVE' }, orderBy: { severity: 'asc' } });
  const stock = await getStockLevels();
  const stockById = new Map(stock.map((s) => [s.id, s]));

  const contexts: AlertContext[] = [];
  for (const a of activeAlerts) {
    const dishes = await dishesUsingIngredient(a.ingredientId);
    const s = stockById.get(a.ingredientId);
    contexts.push({
      alertId: a.id, type: a.type, severity: a.severity, ingredient: a.ingredientName,
      currentQuantity: a.currentQuantity, reorderPoint: a.reorderPoint, unit: a.unit, message: a.message,
      dependentDishes: dishes.map((d) => d.name),
      daysOfCover: s?.daysOfCover ?? null,
    });
  }
  const { actions, model } = await suggestAlertSolutions(contexts);
  res.json({ generatedAt: now, model, actions });
}));

// Expiry scan: raise/update EXPIRY alerts (7-day window; do-not-use on expiry day).
api.post('/alerts/scan-expiries', wrap(async (_req, res) => {
  res.json(await scanExpiries());
}));

// --- Shopping cart (reorder list) ---
api.get('/cart', wrap(async (_req, res) => res.json(await getCart())));
api.delete('/cart/:ingredientId', wrap(async (req, res) => res.json(await removeFromCart(req.params.ingredientId))));
api.post('/cart/:ingredientId/quantity', wrap(async (req, res) => {
  const quantity = req.body?.quantity;
  if (typeof quantity !== 'number') throw new HttpError(400, 'quantity (number) required');
  res.json(await setCartQuantity(req.params.ingredientId, quantity));
}));
api.post('/cart/place', wrap(async (_req, res) => res.json(await placeCart())));

// Direct add to cart by ingredient (push from Close Day / AI suggestions).
api.post('/cart/add', wrap(async (req, res) => {
  const { addIngredientToCart } = await import('../lib/actions.js');
  const ingredientId = req.body?.ingredientId;
  if (!ingredientId) throw new HttpError(400, 'ingredientId required');
  res.json(await addIngredientToCart(ingredientId, typeof req.body?.quantity === 'number' ? req.body.quantity : undefined));
}));

// Push ALL current low/out ingredients to the cart (Close Day / Dashboard button).
api.post('/cart/add-low-stock', wrap(async (_req, res) => {
  const { addLowStockToCart } = await import('../lib/actions.js');
  res.json(await addLowStockToCart());
}));

// AI weekly-demand sizing: suggest a 7-day quantity for one ingredient, or
// apply it to the whole cart.
api.get('/cart/suggest/:ingredientId', wrap(async (req, res) => res.json(await suggestWeeklyQuantity(req.params.ingredientId))));
api.post('/cart/suggest-week', wrap(async (_req, res) => res.json(await applyWeeklySuggestionsToCart())));
// AI-analyzed suggestion: model reasons over recent demand per item.
api.post('/cart/suggest-ai', wrap(async (_req, res) => res.json(await aiAnalyzeCartSuggestions())));

// Vendor comparison for the current cart, and placing an order with a vendor.
api.get('/cart/compare-vendors', wrap(async (_req, res) => res.json(await compareVendorsForCart())));
api.post('/cart/place-with-vendor', wrap(async (req, res) => {
  const vendorId = req.body?.vendorId;
  if (!vendorId) throw new HttpError(400, 'vendorId required');
  res.json(await placeOrderWithVendor(vendorId));
}));

// --- Vendors ---
api.get('/vendors', wrap(async (_req, res) => res.json(await listVendors())));
api.post('/vendors', wrap(async (req, res) => res.json(await addVendor(req.body ?? {}))));
api.delete('/vendors/:id', wrap(async (req, res) => res.json(await removeVendor(req.params.id))));
api.post('/vendors/:id/products', wrap(async (req, res) => {
  const { ingredientId, pricePerPack } = req.body ?? {};
  if (!ingredientId || typeof pricePerPack !== 'number') throw new HttpError(400, 'ingredientId and pricePerPack required');
  res.json(await addVendorProduct(req.params.id, ingredientId, pricePerPack));
}));
// Batch add/update several products at once (checkbox multi-select UI).
api.post('/vendors/:id/products/batch', wrap(async (req, res) => {
  const rows = Array.isArray(req.body?.products) ? req.body.products : [];
  res.json(await addVendorProducts(req.params.id, rows));
}));
api.delete('/vendors/:id/products/:ingredientId', wrap(async (req, res) => {
  res.json(await removeVendorProduct(req.params.id, req.params.ingredientId));
}));

// --- Purchase orders ---
api.get('/purchase-orders', wrap(async (_req, res) => res.json(await listPurchaseOrders())));
api.get('/purchase-orders/pending', wrap(async (_req, res) => res.json(await pendingPurchaseOrders())));
api.post('/purchase-orders/:id/receive', wrap(async (req, res) => res.json(await receivePurchaseOrder(req.params.id))));

// --- Menu (read-only; shared with customer frontend) ---
api.get('/menu', wrap(async (_req, res) => {
  res.json(await prisma.menuItem.findMany({ orderBy: { category: 'asc' }, include: { recipeLines: true } }));
}));

// Projection: expected vs actual per MENU ITEM (defaults to demo today).
api.get('/projection', wrap(async (req, res) => {
  const now = await getDemoNow();
  const businessDate = (req.query.date as string) ?? new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  res.json(await getItemProjectionForDate(businessDate));
}));

// Ingredient-level expectation vs actual (kept for reconciliation views).
api.get('/projection/ingredients', wrap(async (req, res) => {
  const now = await getDemoNow();
  const businessDate = (req.query.date as string) ?? new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  res.json(await getProjectionForDate(businessDate));
}));

// Dish availability status (dashboard dish view): sold_out / attention / safe
// per menu item, with the limiting ingredient. Single-dish detail returns the
// full recipe joined with live stock.
api.get('/dishes/status', wrap(async (_req, res) => res.json(await getAllDishStatuses())));
api.get('/dishes/:key/status', wrap(async (req, res) => {
  const d = await getDishStatus(req.params.key);
  if (!d) throw new HttpError(404, 'Menu item not found');
  res.json(d);
}));

// Manual availability toggle for one dish (86 / un-86).
api.post('/menu/:key/availability', wrap(async (req, res) => {
  const available = req.body?.available;
  if (typeof available !== 'boolean') throw new HttpError(400, 'available (boolean) required');
  res.json(await setMenuAvailability(req.params.key, available));
}));

// Pre-check an order WITHOUT placing or charging it: validates availability +
// inventory and returns { ok, soldOut, unknownItems, reason }. The customer app
// calls this before confirming/charging.
api.post('/orders/precheck', wrap(async (req, res) => {
  const parsed = CanonicalOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: parsed.error.issues.map((i) => i.message).join('; ') } });
  }
  res.json({ data: await precheckOrder(parsed.data) });
}));

// --- Orders: the live sync seam for the customer frontend ---
// Returns the customer-web contract shape: 201 { data: <orderDoc> }.
api.post('/orders', wrap(async (req, res) => {
  const parsed = CanonicalOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: parsed.error.issues.map((i) => i.message).join('; ') } });
  }
  const result = await ingestOrder(parsed.data);
  res.status(201).json({ data: result.order, meta: { alertsRaised: result.alertsRaised, businessDate: result.businessDate } });
}));

// Single order (customer tracking screen reads this): { data: <orderDoc> }.
api.get('/orders/:id', wrap(async (req, res) => {
  const o = await prisma.order.findUnique({ where: { id: req.params.id }, include: { items: true } });
  if (!o) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Order not found' } });
  res.json({ data: {
    id: o.id, status: o.status, createdAt: o.placedAt.toISOString(), updatedAt: o.updatedAt?.toISOString() ?? null,
    statusHistory: o.statusHistory ?? [], total: o.total, fulfillment: o.fulfillment, customerName: o.customerName,
    items: o.items.map((i) => ({ menuItemId: i.menuItemId, name: i.name, quantity: i.quantity, lineTotal: i.lineTotal })),
  } });
}));

// Merchant moves the order through its lifecycle. { data: <orderDoc> } on success.
api.patch('/orders/:id/status', wrap(async (req, res) => {
  const status = req.body?.status;
  if (!status) return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'status required' } });
  const updated = await transitionOrderStatus(req.params.id, status);
  res.json({ data: { id: updated.id, status: updated.status, updatedAt: updated.updatedAt?.toISOString() ?? null, statusHistory: updated.statusHistory ?? [] } });
}));

// Manager list (dashboard) — raw rows.
api.get('/orders', wrap(async (req, res) => {
  const date = req.query.date as string | undefined;
  const status = req.query.status as string | undefined;
  const orders = await prisma.order.findMany({
    where: { ...(date ? { businessDate: date } : {}), ...(status ? { status } : {}) },
    orderBy: { placedAt: 'desc' },
    take: 50,
    include: { items: true },
  });
  res.json(orders);
}));

// --- Simulate rush: generate a burst of synthetic orders (demo fallback) ---
api.post('/simulate/rush', wrap(async (req, res) => {
  const count = Math.min(Math.max(Number(req.body?.count ?? 15), 1), 100);
  const menu = await prisma.menuItem.findMany({ select: { key: true } });
  const channels = ['dine_in', 'takeout', 'website', 'uber_eats', 'doordash', 'barmade'] as const;
  const results = [];
  for (let i = 0; i < count; i++) {
    const nItems = 1 + Math.floor(Math.random() * 3);
    const items = Array.from({ length: nItems }, () => ({
      item_id: menu[Math.floor(Math.random() * menu.length)].key,
      quantity: 1 + Math.floor(Math.random() * 2),
      modifiers: [],
    }));
    const channel = channels[Math.floor(Math.random() * channels.length)];
    results.push(await ingestOrder({ channel, items }));
  }
  res.json({ created: results.length, alertsRaised: results.flatMap((r) => r.alertsRaised) });
}));

// --- Current business day cursor ---
api.get('/day', wrap(async (_req, res) => res.json({ currentDay: await getCurrentDay() })));

// --- Restaurant open/closed status (customer app reads this to stop ordering) ---
api.get('/status', wrap(async (_req, res) => {
  const [closed, currentDay] = await Promise.all([getRestaurantClosed(), getCurrentDay()]);
  res.json({ open: !closed, closed, currentDay });
}));
// Toggle open/closed WITHOUT moving the day cursor. Body: { open: boolean } or { closed: boolean }.
api.post('/status', wrap(async (req, res) => {
  const body = req.body ?? {};
  const closed = typeof body.closed === 'boolean' ? body.closed : typeof body.open === 'boolean' ? !body.open : undefined;
  if (closed === undefined) throw new HttpError(400, 'open (boolean) or closed (boolean) required');
  await setRestaurantClosed(closed);
  res.json({ open: !closed, closed });
}));

// Reopen the day: step the business-day cursor BACK one day and mark open.
api.post('/open-day', wrap(async (_req, res) => {
  const newDay = await openDay();
  res.json({ openedDay: newDay, currentDay: newDay, open: true });
}));

// Open-day readiness check: NO AI. Reports low/out ingredients and active alert
// count so the UI can warn the manager to take action before the new day.
api.get('/open-day/check', wrap(async (_req, res) => {
  const [stock, activeAlerts] = await Promise.all([
    getStockLevels(),
    prisma.alert.findMany({ where: { status: 'ACTIVE' }, orderBy: { severity: 'asc' } }),
  ]);
  const lowOrOut = stock
    .filter((s) => s.status === 'low' || s.status === 'out')
    .map((s) => ({ id: s.id, name: s.name, currentStock: s.currentStock, unit: s.unit, status: s.status }));
  res.json({
    ok: lowOrOut.length === 0 && activeAlerts.length === 0,
    lowOrOut,
    activeAlertCount: activeAlerts.length,
    alerts: activeAlerts.map((a) => ({ id: a.id, type: a.type, severity: a.severity, ingredient: a.ingredientName, message: a.message })),
  });
}));

// --- Close Day: deterministic facts -> LLM phrasing (cached per date) ---
// By default this also ADVANCES the business day (demo clock moves forward).
api.post('/close-day', wrap(async (req, res) => {
  const now = await getDemoNow();
  const businessDate = (req.body?.date as string) ?? new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);

  const force = req.body?.force === true;
  const advance = req.body?.advance !== false; // default: closing the day moves the clock

  let payload: any;
  const cached = !force ? await prisma.dailySummary.findUnique({ where: { businessDate } }) : null;
  if (cached) {
    payload = { ...cached, cached: true };
  } else {
    const facts = await getCloseDayFacts(businessDate);
    const { summaryText, model } = await generateCloseDaySummary(facts);
    const saved = await prisma.dailySummary.upsert({
      where: { businessDate },
      create: { businessDate, summaryText, facts: facts as any, model },
      update: { summaryText, facts: facts as any, model },
    });
    payload = { ...saved, cached: false };
  }

  if (advance) {
    const newDay = await advanceDay();
    payload.closedDay = businessDate;
    payload.newDay = newDay;
    payload.advanced = true;
  }
  res.json(payload);
}));
