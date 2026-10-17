export const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n ?? 0);

export const num = (n: number) => new Intl.NumberFormat('en-US').format(n ?? 0);

export const CHANNEL_LABELS: Record<string, string> = {
  dine_in: 'Dine-in',
  takeout: 'Takeout',
  website: 'Website',
  barmade: 'Barmade',
  uber_eats: 'Uber Eats',
  doordash: 'DoorDash',
};

export const CHANNEL_COLORS: Record<string, string> = {
  dine_in: '#22c55e',
  takeout: '#38bdf8',
  website: '#a78bfa',
  barmade: '#f59e0b',
  uber_eats: '#4ade80',
  doordash: '#fb7185',
};

export const channelLabel = (c: string) => CHANNEL_LABELS[c] ?? c;

// ── Package helpers ──────────────────────────────────────────────────────────
// Restaurants buy/count by the package (case, bag, bottle), not raw base units.
// Recipes still consume base units; these helpers translate for inventory/cart.

export interface PackInfo { packSize: number | null; packLabel: string | null; unit: string; }

/** How many whole packages a base-unit quantity represents (fractional). */
export function baseToPacks(baseQty: number, packSize: number | null): number {
  if (!packSize || packSize <= 0) return baseQty; // no real pack → packages == base
  return baseQty / packSize;
}

/** Pluralize a pack label crudely ("case" → "cases"). Leaves descriptive
 *  labels like "2.5 kg block" readable. */
export function packLabel(label: string | null, n: number): string {
  const l = (label ?? 'pack').trim();
  if (n === 1) return l;
  // only add 's' to simple single-word labels
  return /^[a-z]+$/i.test(l) ? `${l}s` : l;
}

/** Display a base-unit stock as packages with the raw total as context, e.g.
 *  "6.3 cases" + "≈ 15,750 g". When there is no real pack, falls back to base. */
export function fmtPacks(baseQty: number, p: PackInfo): { primary: string; secondary: string } {
  if (!p.packSize || p.packSize <= 1) {
    return { primary: `${num(round1(baseQty))} ${p.unit}`, secondary: '' };
  }
  const packs = baseToPacks(baseQty, p.packSize);
  const packsRounded = round1(packs);
  return {
    primary: `${num(packsRounded)} ${packLabel(p.packLabel, packsRounded)}`,
    secondary: `≈ ${num(Math.round(baseQty))} ${p.unit}`,
  };
}

function round1(n: number) { return Math.round(n * 10) / 10; }
