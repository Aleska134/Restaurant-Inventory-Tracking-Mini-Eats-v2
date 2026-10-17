const { chromium } = require('playwright');

const OUT = process.env.SHOT_DIR || '.';
const BASE = 'http://localhost:5173';
const navLabels = [
  { label: 'Inventory', name: 'inventory' },
  { label: 'Sales', name: 'sales' },
  { label: 'Alerts', name: 'alerts' },
  { label: 'Close Day', name: 'closeday' },
];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const results = [];
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(2000);
  for (const n of navLabels) {
    try {
      // click the sidebar link by its visible text
      await page.getByText(n.label, { exact: true }).first().click();
      await page.waitForTimeout(2500);
      const file = `${OUT}/manager-${n.name}.png`;
      await page.screenshot({ path: file, fullPage: true });
      results.push(`OK ${n.label} -> ${file}`);
    } catch (e) {
      results.push(`ERR ${n.label} -> ${e.message}`);
    }
  }
  console.log(results.join('\n'));
  await browser.close();
})();
