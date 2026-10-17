// Deploy-time DB preparation for Railway. Idempotent: pushes the schema, then
// seeds the synthetic dataset ONLY if the DB is empty (first deploy). Safe to
// run on every deploy -- it will not re-seed or wipe existing data.
// Plain JavaScript (.mjs): NO TypeScript type annotations.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

function run(cmd) {
  console.log('[prepare] $ ' + cmd);
  execSync(cmd, { stdio: 'inherit' });
}

// 1) Make the DB match the schema (no migration history needed for the demo).
run('npx prisma db push --skip-generate');

// 2) Seed only when the DB is empty.
const prisma = new PrismaClient();
try {
  const ingredients = await prisma.ingredient.count();
  if (ingredients === 0) {
    console.log('[prepare] empty DB -> seeding synthetic dataset');
    // Prefer the compiled seed; fall back to tsx if dist is missing.
    if (existsSync('dist/scripts/seed.js')) {
      run('node dist/scripts/seed.js');
    } else {
      run('npx tsx scripts/seed.ts');
    }
  } else {
    console.log('[prepare] DB already has ' + ingredients + ' ingredients -> skip seed');
  }
} finally {
  await prisma.$disconnect();
}
