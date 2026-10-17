// Seed PostgreSQL from the synthetic dataset in ../data.
// Idempotent: wipes the tables first, then loads deterministically.
// Run: npm run seed

import 'dotenv/config';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve the dataset: prefer a copy that ships INSIDE the backend service
// (backend/data — present on Railway where root dir = backend), then fall back
// to the repo-root data/ folder (local monorepo dev). dist/scripts adds a level.
const CANDIDATES = [
  join(__dirname, '..', 'data'),        // backend/dist/scripts -> backend/dist/data? no; see next
  join(__dirname, '..', '..', 'data'),  // backend/scripts -> backend/data  (tsx local)  OR backend/dist/scripts -> backend/data
  join(__dirname, '..', '..', '..', 'data'), // repo-root/data (monorepo)
  join(process.cwd(), 'data'),          // cwd/data (Railway start cwd = backend)
];
const DATA = CANDIDATES.find((p) => existsSync(join(p, 'inventory.json'))) ?? CANDIDATES[1];
console.log('[seed] using data dir:', DATA);

function load<T>(name: string): T {
  return JSON.parse(readFileSync(join(DATA, name), 'utf-8')) as T;
}

async function main() {
  console.log('Loading synthetic dataset from', DATA);
  const inventory = load<any[]>('inventory.json');
  const menu = load<any[]>('menu.json');
  const orders = load<any[]>('orders.json');
  const movements = load<any[]>('movements.json');
  const alerts = load<any[]>('alerts.json');

  console.log('Clearing existing data...');
  await prisma.movement.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.recipeLine.deleteMany();
  await prisma.batch.deleteMany();
  await prisma.menuItem.deleteMany();
  await prisma.ingredient.deleteMany();
  await prisma.dailySummary.deleteMany();

  // --- Ingredients + batches ---
  console.log(`Ingredients: ${inventory.length}`);
  for (const ing of inventory) {
    await prisma.ingredient.create({
      data: {
        id: ing.id,
        name: ing.name,
        category: ing.category,
        unit: ing.unit,
        reorderPoint: ing.reorderPoint ?? 0,
        kind: ing.kind ?? 'purchased',
        supplier: ing.supplier ?? null,
        packSize: ing.packSize ?? null,
        packLabel: ing.packLabel ?? null,
        shelfLifeDays: ing.shelfLifeDays ?? null,
        targetDays: ing.targetDays ?? null,
        key: ing.key ?? null,
        batches: {
          create: (ing.batches ?? []).map((b: any) => ({
            batchId: b.batchId,
            quantity: b.quantity,
            arrivedAt: new Date(b.arrivedAt),
            expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
          })),
        },
      },
    });
  }

  // --- Menu + recipe lines ---
  console.log(`Menu items: ${menu.length}`);
  for (const m of menu) {
    await prisma.menuItem.create({
      data: {
        id: m.id,
        key: m.key,
        name: m.name,
        category: m.category,
        price: m.price,
        modifierIds: m.modifierIds ?? [],
        recipeLines: {
          create: (m.ingredients ?? []).map((r: any) => ({
            ingredientId: r.ingredientId,
            quantity: r.quantity,
          })),
        },
      },
    });
  }

  // --- Orders + items (batched) ---
  console.log(`Orders: ${orders.length}`);
  const CHUNK = 500;
  for (let i = 0; i < orders.length; i += CHUNK) {
    const slice = orders.slice(i, i + CHUNK);
    await prisma.$transaction(
      slice.map((o: any) =>
        prisma.order.create({
          data: {
            id: o.id,
            status: o.status ?? 'COMPLETED',
            channel: o.channel,
            placedAt: new Date(o.placed_at ?? o.createdAt),
            businessDate: o.business_date,
            total: o.total ?? o.gross_total ?? 0,
            grossTotal: o.gross_total ?? o.total ?? 0,
            channelFeeRate: o.channel_fee_rate ?? 0,
            channelFee: o.channel_fee ?? 0,
            netTotal: o.net_total ?? o.total ?? 0,
            items: {
              create: (o.items ?? []).map((it: any) => ({
                menuItemId: it.menuItemId,
                itemKey: it.item_id,
                name: it.name,
                quantity: it.quantity,
                unitPrice: it.unitPrice,
                lineTotal: it.lineTotal,
                modifiers: it.modifiers ?? [],
              })),
            },
          },
        }),
      ),
    );
    process.stdout.write(`  orders ${Math.min(i + CHUNK, orders.length)}/${orders.length}\r`);
  }
  console.log('');

  // --- Movements (batched createMany) ---
  console.log(`Movements: ${movements.length}`);
  for (let i = 0; i < movements.length; i += 2000) {
    const slice = movements.slice(i, i + 2000).map((mv: any) => ({
      id: mv.id,
      ingredientId: mv.ingredient_id,
      ingredientName: mv.ingredient,
      change: mv.change,
      unit: mv.unit,
      reason: mv.reason,
      orderId: mv.order_id ?? null,
      batchId: mv.batch_id ?? null,
      timestamp: new Date(mv.timestamp),
      businessDate: mv.business_date,
      balanceAfter: mv.balance_after ?? null,
      note: mv.note ?? null,
    }));
    await prisma.movement.createMany({ data: slice, skipDuplicates: true });
    process.stdout.write(`  movements ${Math.min(i + 2000, movements.length)}/${movements.length}\r`);
  }
  console.log('');

  // --- Alerts ---
  console.log(`Alerts: ${alerts.length}`);
  await prisma.alert.createMany({
    data: alerts.map((a: any) => ({
      id: a.id,
      type: a.type,
      status: a.status,
      severity: a.severity,
      ingredientId: a.ingredientId,
      ingredientName: a.ingredientName,
      currentQuantity: a.currentQuantity ?? null,
      reorderPoint: a.reorderPoint ?? null,
      unit: a.unit ?? null,
      message: a.message,
      resolution: a.resolution ?? null,
      createdAt: new Date(a.createdAt),
      updatedAt: a.updatedAt ? new Date(a.updatedAt) : null,
      resolvedAt: a.resolvedAt ? new Date(a.resolvedAt) : null,
    })),
    skipDuplicates: true,
  });

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
