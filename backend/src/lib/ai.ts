// OpenRouter integration. The ONLY place the LLM is used, and it only phrases
// language from facts computed by calc.ts — it is told never to invent numbers.

interface CloseDayFacts {
  businessDate: string;
  orders: number;
  grossRevenue: number;
  netRevenue: number;
  totalFees: number;
  topDishes: { name: string; qty: number; revenue: number }[];
  bottomDishes: { name: string; qty: number; revenue: number }[];
  channelMix: { channel: string; gross: number; net: number; feePct: number }[];
  lowOrOutIngredients: { name: string; currentStock: number; unit: string; status: string }[];
  overstockSpecials: { ingredient: string; suggestedDishes: string[] }[];
  activeAlerts: { type: string; severity: string; ingredient: string; message: string }[];
}

const SYSTEM_PROMPT = `You are the end-of-day assistant for a restaurant manager dashboard.
You receive ONLY structured, already-computed facts. You MUST NOT invent, recompute, or alter any number.
Use only figures present in the facts. If a figure is not provided, do not state it.
Write a concise summary in exactly this structure using markdown:
1. **Headline** — one sentence.
2. **What went well** — 2-3 bullets.
3. **Concerns** — 2-3 bullets (low stock, high channel fees, anomalies).
4. **Recommended actions** — 2-3 bullets, including any overstock special.
Keep it under 220 words. Plain, professional tone.`;

export interface SummaryResult {
  summaryText: string;
  model: string;
}

export async function generateCloseDaySummary(facts: CloseDayFacts): Promise<SummaryResult> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    return { summaryText: deterministicSummary(facts), model: 'deterministic-fallback' };
  }
  const userContent = `Business date: ${facts.businessDate}\n\nFACTS (JSON):\n${JSON.stringify(facts, null, 2)}`;
  const r = await callOpenRouter(apiKey, SYSTEM_PROMPT, userContent, 0.3);
  if (r) return { summaryText: r.text, model: r.model };
  return { summaryText: deterministicSummary(facts), model: 'deterministic-fallback' };
}

/** Shared OpenRouter call: tries the primary model then fallbacks, returns the
 *  first non-empty completion with the model that produced it, or null if all
 *  attempts failed (callers then use a deterministic fallback). */
async function callOpenRouter(
  apiKey: string,
  systemPrompt: string,
  userContent: string,
  temperature = 0.3,
  modelOverride?: string[],
  timeoutMs = 90000,
): Promise<{ text: string; model: string } | null> {
  const models = modelOverride && modelOverride.length ? modelOverride : [
    process.env.OPENROUTER_MODEL?.trim() || 'nvidia/nemotron-nano-9b-v2:free',
    ...(process.env.OPENROUTER_FALLBACK_MODELS?.split(',').map((m) => m.trim()).filter(Boolean) ?? []),
  ];
  let lastErr = '';
  for (const model of models) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:5173',
          'X-Title': 'Barmade Manager Dashboard',
        },
        body: JSON.stringify({
          model,
          temperature,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
        }),
      });
      if (!res.ok) { lastErr = `${model}: HTTP ${res.status} ${await res.text()}`; continue; }
      const data = (await res.json()) as any;
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (text) return { text, model };
      lastErr = `${model}: empty response`;
    } catch (e) {
      lastErr = `${model}: ${(e as Error).message}`;
    } finally {
      clearTimeout(timer);
    }
  }
  console.warn('[openrouter] all models failed:', lastErr);
  return null;
}

/** Facts-only summary used when no API key is set or OpenRouter is unreachable.
 *  Guarantees the Close Day demo always produces something grounded. */
function deterministicSummary(f: CloseDayFacts): string {
  const top = f.topDishes[0];
  const worstFee = [...f.channelMix].sort((a, b) => b.feePct - a.feePct)[0];
  const special = f.overstockSpecials[0];
  const lines: string[] = [];
  lines.push(`1. **Headline** — ${f.businessDate}: ${f.orders} orders, $${f.grossRevenue} gross / $${f.netRevenue} net.`);
  lines.push('2. **What went well**');
  if (top) lines.push(`   - Best seller: ${top.name} (${top.qty} sold, $${top.revenue}).`);
  lines.push(`   - Net revenue of $${f.netRevenue} after $${f.totalFees} in channel fees.`);
  lines.push('3. **Concerns**');
  if (f.lowOrOutIngredients.length)
    lines.push(`   - Low/out of stock: ${f.lowOrOutIngredients.map((i) => `${i.name} (${i.currentStock}${i.unit})`).join(', ')}.`);
  if (worstFee && worstFee.feePct > 0)
    lines.push(`   - ${worstFee.channel} kept ${worstFee.feePct}% of its gross in fees.`);
  if (f.activeAlerts.length) lines.push(`   - ${f.activeAlerts.length} active alert(s).`);
  lines.push('4. **Recommended actions**');
  if (special)
    lines.push(`   - Run a special on ${special.suggestedDishes.slice(0, 2).join(' or ')} to move overstocked ${special.ingredient}.`);
  if (f.lowOrOutIngredients.length)
    lines.push(`   - Reorder ${f.lowOrOutIngredients[0].name} before the next rush.`);
  lines.push('   - Review delivery-channel pricing against in-house margins.');
  return lines.join('\n');
}



// ------------------------------------------------------------------
// Alert solution suggestions (batch). The model proposes a plan; code applies
// it. Language-only guardrail holds: the LLM returns which EXISTING action to
// take per alert (reorder / eighty_six / monitor) plus a reason — it never
// writes stock numbers or mutates anything itself.
// ------------------------------------------------------------------

export interface AlertContext {
  alertId: string;
  type: string;
  severity: string;
  ingredient: string;
  currentQuantity: number | null;
  reorderPoint: number | null;
  unit: string | null;
  message: string;
  dependentDishes: string[]; // dish names that use this ingredient
  daysOfCover: number | null;
}

export interface SuggestedAction {
  alertId: string;
  ingredient: string;
  recommended: 'reorder' | 'eighty_six' | 'monitor';
  reason: string;
  dependentDishes: string[];
}

const SUGGEST_PROMPT = `You are an operations assistant for a restaurant manager.
You receive a JSON array of active stock/expiry alerts, each with the dishes that depend on the ingredient.
For EACH alert, choose exactly ONE recommended action from this fixed set and explain why in one sentence:
- "reorder": stock is low/out or expiring and the ingredient should be restocked.
- "eighty_six": the ingredient is out/unusable right now and the dependent dishes should be marked sold out until restocked.
- "monitor": not urgent; keep watching.
Return ONLY valid JSON (no markdown, no prose) of shape:
{"actions":[{"alertId":"...","recommended":"reorder|eighty_six|monitor","reason":"..."}]}
Use only the facts given. Do not invent ingredients, dishes, or numbers.`;

export async function suggestAlertSolutions(
  alerts: AlertContext[],
): Promise<{ actions: SuggestedAction[]; model: string }> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const byId = new Map(alerts.map((a) => [a.alertId, a]));

  if (apiKey && alerts.length) {
    const userContent = `ALERTS (JSON):\n${JSON.stringify(alerts, null, 2)}`;
    const r = await callOpenRouter(apiKey, SUGGEST_PROMPT, userContent, 0.2);
    if (r) {
      const parsed = safeParseActions(r.text);
      if (parsed) {
        const actions: SuggestedAction[] = parsed
          .filter((a) => byId.has(a.alertId))
          .map((a) => {
            const ctx = byId.get(a.alertId)!;
            const rec: SuggestedAction['recommended'] =
              a.recommended === 'reorder' || a.recommended === 'eighty_six' || a.recommended === 'monitor'
                ? a.recommended
                : 'monitor';
            return { alertId: a.alertId, ingredient: ctx.ingredient, recommended: rec, reason: a.reason ?? '', dependentDishes: ctx.dependentDishes };
          });
        // Ensure every alert gets an action even if the model skipped some.
        for (const ctx of alerts) if (!actions.find((x) => x.alertId === ctx.alertId)) actions.push(deterministicAction(ctx));
        return { actions, model: r.model };
      }
    }
  }
  // Deterministic fallback: rule-based plan.
  return { actions: alerts.map(deterministicAction), model: 'deterministic-fallback' };
}

function deterministicAction(ctx: AlertContext): SuggestedAction {
  const out = (ctx.currentQuantity ?? 0) <= 0;
  const expiring = ctx.type === 'EXPIRY';
  let recommended: SuggestedAction['recommended'];
  let reason: string;
  if (out && ctx.dependentDishes.length) {
    recommended = 'eighty_six';
    reason = `${ctx.ingredient} is out and blocks ${ctx.dependentDishes.length} dish(es); 86 them until restocked.`;
  } else if (ctx.severity === 'critical' || ctx.severity === 'high' || expiring) {
    recommended = 'reorder';
    reason = expiring
      ? `${ctx.ingredient} is expiring; reorder fresh stock.`
      : `${ctx.ingredient} is below reorder point; book a restock.`;
  } else {
    recommended = 'monitor';
    reason = `${ctx.ingredient} is low but not urgent; keep watching.`;
  }
  return { alertId: ctx.alertId, ingredient: ctx.ingredient, recommended, reason, dependentDishes: ctx.dependentDishes };
}

function safeParseActions(text: string): { alertId: string; recommended: string; reason?: string }[] | null {
  try {
    // Strip code fences if the model added them despite instructions.
    const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    const obj = JSON.parse(cleaned);
    if (Array.isArray(obj?.actions)) return obj.actions;
    if (Array.isArray(obj)) return obj;
    return null;
  } catch {
    return null;
  }
}



// ------------------------------------------------------------------
// AI reorder analysis. The model ANALYZES recent demand (not just usage×7) and
// recommends a package quantity per ingredient with a one-line rationale. The
// numbers it sees are computed by code; it reasons about them. Deterministic
// par-level fallback keeps it working offline.
// ------------------------------------------------------------------

export interface ReorderContext {
  ingredientId: string;
  name: string;
  unit: string;
  packLabel: string | null;
  packSize: number;
  currentStock: number;        // base units on hand
  currentPacks: number;        // packages on hand
  avgDailyUsage: number;       // base units/day (trailing)
  last7DaysUsage: number[];    // base units used each of the last 7 days (oldest→newest)
  reorderPoint: number;
  parPacks: number;            // code's par-level suggestion (packages) as a baseline
}

export interface ReorderRecommendation {
  ingredientId: string;
  name: string;
  recommendedPacks: number;
  rationale: string;
}

const REORDER_PROMPT = `You are a restaurant purchasing analyst. For EACH ingredient you receive recent demand data and a baseline par suggestion.
Analyze the trend in last7DaysUsage (rising, falling, steady, spiky), the days of cover left (currentStock / avgDailyUsage), and the baseline par.
Recommend how many PACKAGES to order to comfortably cover the coming week WITHOUT large over-ordering. Prefer the baseline par unless the trend justifies more or less; if demand is falling or stock is already high, recommend LESS; if rising/spiky, a little more. Round to whole packages.
Return ONLY JSON (no markdown): {"recommendations":[{"ingredientId":"...","recommendedPacks":N,"rationale":"one short sentence"}]}
Use only the numbers given. Do not invent data.`;

export async function analyzeReorders(contexts: ReorderContext[]): Promise<{ recommendations: ReorderRecommendation[]; model: string }> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const byId = new Map(contexts.map((c) => [c.ingredientId, c]));

  if (apiKey && contexts.length) {
    const userContent = `INGREDIENTS (JSON):\n${JSON.stringify(contexts, null, 2)}`;
    // Prefer FAST nemotron models here — this is an interactive button, not the
    // once-a-day Close Day summary, so latency matters more than peak quality.
    const fastModels = ['nvidia/nemotron-3.5-lightning:free', 'nvidia/nemotron-3-super-120b-a12b:free'];
    const r = await callOpenRouter(apiKey, REORDER_PROMPT, userContent, 0.2, fastModels, 12000);
    if (r) {
      try {
        const cleaned = r.text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
        const parsed = JSON.parse(cleaned);
        const recs: ReorderRecommendation[] = (parsed?.recommendations ?? [])
          .filter((x: any) => byId.has(x.ingredientId))
          .map((x: any) => {
            const ctx = byId.get(x.ingredientId)!;
            let packs = Math.round(Number(x.recommendedPacks));
            if (!Number.isFinite(packs) || packs < 0) packs = ctx.parPacks;
            // guardrail: never more than 2x the par, never less than 1 if below reorder
            packs = Math.min(packs, Math.max(1, ctx.parPacks * 2));
            if (packs < 1 && ctx.currentStock < ctx.reorderPoint) packs = 1;
            return { ingredientId: ctx.ingredientId, name: ctx.name, recommendedPacks: packs, rationale: String(x.rationale ?? '').slice(0, 160) };
          });
        for (const ctx of contexts) if (!recs.find((r2) => r2.ingredientId === ctx.ingredientId)) recs.push(fallbackRec(ctx));
        return { recommendations: recs, model: r.model };
      } catch { /* fall through */ }
    }
  }
  return { recommendations: contexts.map(fallbackRec), model: 'deterministic-fallback' };
}

function fallbackRec(ctx: ReorderContext): ReorderRecommendation {
  const daysCover = ctx.avgDailyUsage > 0 ? ctx.currentStock / ctx.avgDailyUsage : null;
  const trend = trendOf(ctx.last7DaysUsage);
  const rationale = daysCover !== null
    ? `${daysCover.toFixed(1)} days of cover left; demand ${trend}. Ordering to a ~1-week par.`
    : `Low/no recent usage; topping up to par.`;
  return { ingredientId: ctx.ingredientId, name: ctx.name, recommendedPacks: ctx.parPacks, rationale };
}

function trendOf(series: number[]): string {
  if (series.length < 4) return 'steady';
  const half = Math.floor(series.length / 2);
  const first = series.slice(0, half).reduce((a, b) => a + b, 0) / Math.max(1, half);
  const second = series.slice(half).reduce((a, b) => a + b, 0) / Math.max(1, series.length - half);
  if (second > first * 1.2) return 'rising';
  if (second < first * 0.8) return 'falling';
  return 'steady';
}

// ------------------------------------------------------------------
// Vendor purchase-order email (AI-phrased, relationship-aware voice).
// The model only phrases language around facts we give it (vendor name, line
// items, totals). It must never invent prices, quantities or terms. The TONE
// is chosen by the vendor's relationship so a corner grocer and a national
// distributor don't get the same boilerplate.
// ------------------------------------------------------------------

export type VendorRelationship = 'local' | 'regional' | 'corporate';

export interface VendorEmailItem {
  ingredientName: string;
  packs: number;
  packSize: number;
  unit: string;
  pricePerPack: number;
  lineTotal: number;
}

export interface VendorEmailContext {
  restaurantName: string;
  vendorName: string;
  relationship: VendorRelationship;
  items: VendorEmailItem[];
  total: number;
}

export interface VendorEmailResult {
  subject: string;
  body: string;
  model: string;
}

const VOICE_GUIDE: Record<VendorRelationship, string> = {
  local:
    'This is a small LOCAL supplier the manager knows personally. Write warm, first-name, neighbourly — a short friendly greeting, plain language, a human sign-off. No corporate jargon, no PO/reference numbers, no legalese. 2-4 short sentences around the order.',
  regional:
    'This is a REGIONAL supplier with a solid ongoing working relationship. Write professional but friendly and direct — courteous greeting, clear request, a brief thanks. Neither chummy nor stiff.',
  corporate:
    'This is a large CORPORATE distributor. Write formal B2B procurement language — structured, concise, references a standing supply agreement and requests confirmation of availability, lead time and delivery window. Impersonal and precise.',
};

const VENDOR_EMAIL_PROMPT = `You write a restaurant's purchase-order email to a supplier.
You are given the restaurant name, the supplier name, the supplier RELATIONSHIP, the exact line items (ingredient, packs, pack size, unit, price per pack, line total) and the order total.
Rules:
- Use ONLY the facts provided. Never invent, change, add or drop items, prices, quantities or totals.
- Match the VOICE exactly to the relationship guidance given.
- Include the itemised list (one line per item with its packs and price) and the order total somewhere in the body.
- Ask the supplier to confirm availability and a delivery window.
Return ONLY valid JSON (no markdown, no prose outside the JSON) of shape:
{"subject":"...","body":"..."}
The body may contain \\n newlines.`;

/** Build the PO email in the vendor's relationship voice. Falls back to a
 *  deterministic per-relationship template when no API key / model fails. */
export async function generateVendorOrderEmail(ctx: VendorEmailContext): Promise<VendorEmailResult> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (apiKey) {
    const facts = {
      restaurantName: ctx.restaurantName,
      vendorName: ctx.vendorName,
      relationship: ctx.relationship,
      items: ctx.items.map((i) => ({
        ingredient: i.ingredientName,
        packs: i.packs,
        packSize: i.packSize,
        unit: i.unit,
        pricePerPack: i.pricePerPack,
        lineTotal: i.lineTotal,
      })),
      orderTotal: ctx.total,
    };
    const userContent = `VOICE GUIDANCE: ${VOICE_GUIDE[ctx.relationship]}\n\nFACTS (JSON):\n${JSON.stringify(facts, null, 2)}`;
    const r = await callOpenRouter(apiKey, VENDOR_EMAIL_PROMPT, userContent, 0.6);
    if (r) {
      const parsed = safeParseEmail(r.text);
      if (parsed && parsed.subject && parsed.body) {
        return { subject: parsed.subject, body: parsed.body, model: r.model };
      }
    }
  }
  const fb = deterministicVendorEmail(ctx);
  return { ...fb, model: 'deterministic-fallback' };
}

function safeParseEmail(text: string): { subject: string; body: string } | null {
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    const obj = JSON.parse(text.slice(start, end + 1));
    if (obj && typeof obj.subject === 'string' && typeof obj.body === 'string') {
      return { subject: obj.subject, body: obj.body };
    }
    return null;
  } catch {
    return null;
  }
}

/** Per-relationship deterministic templates so the demo always produces a
 *  tone-appropriate email even with no LLM available. */
function deterministicVendorEmail(ctx: VendorEmailContext): { subject: string; body: string } {
  const lines = ctx.items
    .map((i) => `  • ${i.ingredientName}: ${i.packs} pack${i.packs === 1 ? '' : 's'} (${i.packSize} ${i.unit} each) @ $${i.pricePerPack.toFixed(2)} = $${i.lineTotal.toFixed(2)}`)
    .join('\n');
  const total = `$${ctx.total.toFixed(2)}`;
  if (ctx.relationship === 'local') {
    return {
      subject: `Quick order from ${ctx.restaurantName} 🙂`,
      body: `Hi ${ctx.vendorName},

Hope you're doing well! Could we grab the following when you get a chance?

${lines}

That comes to ${total}. Let me know if everything's in stock and roughly when you could get it over to us.

Thanks so much,
${ctx.restaurantName}`,
    };
  }
  if (ctx.relationship === 'corporate') {
    return {
      subject: `Purchase Order — ${ctx.restaurantName} (${ctx.items.length} line items)`,
      body: `Dear ${ctx.vendorName} Accounts Team,

Please find our purchase order below, submitted under our existing supply agreement:

${lines}

Order total: ${total}

Kindly confirm product availability, unit pricing, lead time and the earliest delivery window. Please reference ${ctx.restaurantName} on all shipping and invoicing documents.

Regards,
Procurement — ${ctx.restaurantName}`,
    };
  }
  // regional (default)
  return {
    subject: `Purchase order — ${ctx.restaurantName} (${ctx.items.length} items)`,
    body: `Hello ${ctx.vendorName},

Please supply the following for ${ctx.restaurantName}:

${lines}

Order total: ${total}

Kindly confirm availability and your delivery window.

Thank you,
${ctx.restaurantName} — Manager`,
  };
}
