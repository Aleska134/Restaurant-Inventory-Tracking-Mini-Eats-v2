import "server-only";
import menuJson from "@/data/barmade/menu.json";
import inventoryJson from "@/data/barmade/inventory.json";
import metadataJson from "@/data/barmade/metadata.json";
import { CATEGORY_ORDER, MODIFIERS, TRATTORIA_COPY, type Localized, type Taste } from "./content";
import { store } from "./store";
import { barmadeMode, liveStock, readLive, getRestaurantStatus } from "./barmade";

// ---- Source data (BarMade synthetic dataset) -------------------------------

export interface MenuRow {
  id: string;
  key: string;
  name: string;
  price: number;
  category: string;
  modifierIds: string[];
  ingredients: { ingredientId: string; quantity: number }[];
  /** false = on the menu but not offered by the restaurant right now (shown as sold out) */
  active?: boolean;
}
interface InventoryRow {
  id: string;
  name: string;
  unit: string;
  reorderPoint: number;
  batches: { quantity: number }[];
}

const MENU = menuJson as MenuRow[];
const INVENTORY = inventoryJson as InventoryRow[];
const INGREDIENTS = new Map(INVENTORY.map((i) => [i.id, i]));

/** Commission per channel, as used in orders.json. */
export const CHANNEL_FEE_RATE = { barmade: 0.05, website: 0.029, doordash: 0.25, uber_eats: 0.3, dine_in: 0, takeout: 0 } as const;

// ---- Allergens & diet, derived from recipe ingredients ---------------------

export type { Allergen } from "./types";
import type { Allergen } from "./types";

const INGREDIENT_FLAGS: Record<string, Allergen[]> = {
  "ING-002": ["dairy"], // Mozzarella
  "ING-003": ["gluten"], // Pizza Dough
  "ING-004": ["pork", "meat"], // Pepperoni
  "ING-005": ["gluten"], // Spaghetti
  "ING-006": ["dairy"], // Alfredo Sauce
  "ING-007": ["dairy"], // Parmesan
  "ING-009": ["meat"], // Chicken
  "ING-013": ["gluten"], // Flour
  "ING-014": ["dairy"], // Heavy Cream
  "ING-015": ["dairy"], // Butter
  "ING-016": ["meat"], // Ground Beef
  "ING-017": ["egg"], // Eggs
  "ING-018": ["gluten"], // Breadcrumbs
  "ING-019": ["meat", "gluten", "egg"], // Meatballs
  "ING-020": ["gluten", "egg"], // Lasagna Sheets
  "ING-021": ["dairy"], // Ricotta
  "ING-023": ["egg", "fish", "dairy"], // Caesar Dressing (anchovy, yolk, parmesan)
  "ING-024": ["pork", "meat"], // Pancetta
  "ING-025": ["gluten"], // Penne
  "ING-027": ["gluten"], // Italian Bread
  "ING-028": ["dairy"], // Mascarpone
  "ING-029": ["gluten", "egg"], // Ladyfingers
};
const ALLERGEN_ORDER: Allergen[] = ["dairy", "gluten", "egg", "fish", "pork", "meat"];

// ---- Recipes & stock --------------------------------------------------------

export interface LineInput {
  menuItemId: string;
  quantity: number;
  modifiers: string[];
}

/** Ingredient usage for one serving, including modifiers (matches orders.json `consumed`). */
export function recipeFor(item: MenuRow, modifiers: string[]): Map<string, number> {
  const use = new Map<string, number>();
  for (const ing of item.ingredients) use.set(ing.ingredientId, ing.quantity);
  if (modifiers.includes("no_cheese")) use.delete("ING-002");
  else if (modifiers.includes("extra_cheese") && use.has("ING-002")) use.set("ING-002", use.get("ING-002")! * 1.5);
  if (modifiers.includes("add_chicken")) use.set("ING-009", (use.get("ING-009") ?? 0) + 120);
  return use;
}

/** Menu rows + stock the app works with right now. */
export interface Catalog {
  rows: MenuRow[];
  stock: Map<string, number>;
  live: boolean;
  /** Ingredient the kitchen has the most of (relative to its reorder point), for the chef's special. */
  plentiful?: { id: string; name: string };
}

/**
 * Default: the synthetic dataset, minus what customer-app orders consumed.
 * BarMade mode: the backend's live menu (price + recipe) and batch stock. Dataset dishes the
 * backend doesn't serve stay visible as sold out; falls back to the dataset if the backend is down.
 */
export async function loadCatalog(): Promise<Catalog> {
  if (barmadeMode()) {
    try {
      const live = await readLive();
      const byId = new Map(live.menu.map((m) => [m.id, m]));
      const rows: MenuRow[] = MENU.map((m) => {
        const l = byId.get(m.id);
        // The backend has no modifiers, so none are offered (keeps price + inventory consistent).
        return l
          ? { ...m, name: l.name || m.name, price: Number(l.price), ingredients: l.ingredients ?? m.ingredients, modifierIds: [], active: l.available !== false }
          : { ...m, modifierIds: [], active: false };
      });
      for (const l of live.menu)
        if (!MENU.some((m) => m.id === l.id))
          rows.push({ id: l.id, key: l.key ?? l.id, name: l.name, price: Number(l.price), category: l.category ?? "Entree", modifierIds: [], ingredients: l.ingredients ?? [], active: l.available !== false });
      const stock = liveStock(live.inventory);
      const plentiful = live.inventory
        .filter((i) => (i.reorderPoint ?? 0) > 0 && rows.some((r) => r.active && r.category !== "Beverage" && r.ingredients.some((x) => x.ingredientId === i.id)))
        .map((i) => ({ id: i.id, name: i.name, ratio: (stock.get(i.id) ?? 0) / i.reorderPoint! }))
        .sort((a, b) => b.ratio - a.ratio)[0];
      return { rows, stock, live: true, plentiful: plentiful && plentiful.ratio > 1.5 ? plentiful : undefined };
    } catch (err) {
      console.error("BarMade live menu unavailable, using dataset", err instanceof Error ? err.message : err);
    }
  }
  if (barmadeMode()) {
    // Backend unreachable and nothing cached: dataset stock as a rough estimate (orders still go to the backend).
    return { rows: MENU, stock: new Map(INVENTORY.map((i) => [i.id, i.batches.reduce((s, b) => s + b.quantity, 0)])), live: false };
  }
  return { rows: MENU, stock: await currentStock(), live: false };
}

export function menuItem(catalog: Catalog, id: string) {
  return catalog.rows.find((m) => m.id === id);
}

export function unitPrice(item: MenuRow, modifiers: string[]) {
  return round2(item.price + modifiers.reduce((s, m) => s + (MODIFIERS[m]?.price ?? 0), 0));
}

/**
 * Estimated stock = dataset stock − what customer-app orders have consumed since.
 * When the team's live inventory is in the shared DB, swap this one function to read it.
 */
export async function currentStock(): Promise<Map<string, number>> {
  const stock = new Map(INVENTORY.map((i) => [i.id, i.batches.reduce((s, b) => s + b.quantity, 0)]));
  for (const [ing, used] of await store().consumedByApp()) stock.set(ing, (stock.get(ing) ?? 0) - used);
  return stock;
}

export function servingsLeft(item: MenuRow, stock: Map<string, number>, modifiers: string[] = []) {
  if (item.active === false) return 0;
  let min = Infinity;
  for (const [ing, qty] of recipeFor(item, modifiers)) {
    if (qty > 0) min = Math.min(min, Math.floor((stock.get(ing) ?? 0) / qty));
  }
  return Math.max(0, min === Infinity ? 0 : min);
}

// ---- Public menu ------------------------------------------------------------

export const LOW_SERVINGS = 8;

export interface Dish {
  id: string;
  key: string;
  name: Localized;
  description: Localized;
  category: string;
  price: number;
  image: string;
  tastes: Taste[];
  allergens: Allergen[];
  vegetarian: boolean;
  modifiers: { id: string; label: Localized; price: number }[];
  servingsLeft: number;
  status: "available" | "low" | "sold_out";
}

export interface ChefSpecial {
  dishId: string;
  ingredient: string;
  reason: Localized;
}

export interface Menu {
  dishes: Dish[];
  categories: string[];
  special: ChefSpecial | null;
  closed?: boolean;
}

export async function getMenu(): Promise<Menu> {
  const { rows, stock, live, plentiful } = await loadCatalog();
  const status = live ? await getRestaurantStatus().catch(() => ({ closed: false })) : { closed: false };
  const dishes: Dish[] = rows.map((m) => {
    const copy = TRATTORIA_COPY[m.key];
    const flags = new Set(m.ingredients.flatMap((i) => INGREDIENT_FLAGS[i.ingredientId] ?? []));
    const left = servingsLeft(m, stock);
    return {
      id: m.id,
      key: m.key,
      name: { en: m.name, es: copy?.name_es ?? m.name },
      description: copy?.description ?? { en: "", es: "" },
      category: m.category,
      price: m.price,
      image: copy?.image ?? "/images/placeholder.svg",
      tastes: copy?.tastes ?? [],
      allergens: ALLERGEN_ORDER.filter((a) => flags.has(a) && a !== "meat"),
      vegetarian: !flags.has("meat") && !flags.has("fish"),
      modifiers: m.modifierIds.filter((id) => MODIFIERS[id]).map((id) => ({ id, ...MODIFIERS[id] })),
      servingsLeft: left,
      status: left === 0 ? "sold_out" : left <= LOW_SERVINGS ? "low" : "available",
    };
  });
  const categories = CATEGORY_ORDER.filter((c) => dishes.some((d) => d.category === c));
  return { dishes, categories, special: chefSpecial(dishes, rows, live ? plentiful ?? null : undefined), closed: !!status.closed };
}

/**
 * FR-8 overstock special, computed deterministically: the available dish that uses the
 * most of the overstocked ingredient per serving (from metadata.stories.overstock).
 */
function chefSpecial(dishes: Dish[], rows: MenuRow[], liveIngredient?: { id: string; name: string } | null): ChefSpecial | null {
  // Live: whatever the restaurant has plenty of right now. Dataset: the scripted overstock story.
  const ingId = liveIngredient === undefined ? metadataJson.stories?.overstock?.ingredient_id : liveIngredient?.id;
  const ing = ingId ? (liveIngredient ?? INGREDIENTS.get(ingId)) : undefined;
  if (!ing) return null;
  const candidates = rows.map((m) => ({ m, use: m.ingredients.find((i) => i.ingredientId === ing.id)?.quantity ?? 0 }))
    .filter(({ m, use }) => use > 0 && dishes.find((d) => d.id === m.id)?.status === "available")
    .sort((a, b) => b.use - a.use || a.m.price - b.m.price);
  const pick = candidates[0]?.m;
  if (!pick) return null;
  return {
    dishId: pick.id,
    ingredient: ing.name,
    reason:
      liveIngredient === undefined
        ? {
            en: `The kitchen just got a fresh delivery of ${ing.name.toLowerCase()}, and this dish makes the most of it.`,
            es: `La cocina acaba de recibir ${ES_INGREDIENT[ing.id] ?? ing.name.toLowerCase()} fresca, y este plato la aprovecha al máximo.`,
          }
        : {
            en: `Today's chef pick: it makes the most of our fresh ${ing.name.replace(/^.*\((.+)\)$/, "$1").toLowerCase()}.`,
            es: `La recomendación del chef hoy: aprovecha al máximo nuestro ${ES_INGREDIENT[ing.id] ?? ing.name.toLowerCase()} fresco.`,
          },
  };
}

const ES_INGREDIENT: Record<string, string> = {
  "ING-001": "salsa de tomate",
  "ING-002": "queso mozzarella",
  "ING-003": "masa de pizza",
  "ING-004": "pepperoni",
  "ING-005": "spaghetti",
  "ING-006": "salsa Alfredo",
  "ING-007": "queso parmesano",
  "ING-008": "aceite de oliva",
  "ING-009": "pollo",
  "ING-010": "ajo",
  "ING-011": "albahaca",
};

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}
