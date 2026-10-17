import "server-only";
import { getMenu } from "./catalog";
import { allowedFor } from "./recommend";
import type { Taste } from "./content";
import { restaurantById, type Restaurant } from "./content";
import type { ViewDish, ViewRestaurant, ViewSpecial } from "./types";

export function toViewRestaurant(r: Restaurant): ViewRestaurant {
  const { dishes: _d, ...rest } = r;
  return rest;
}

export async function restaurantView(id: string): Promise<
  {
    restaurant: ViewRestaurant;
    dishes: ViewDish[];
    categories: string[];
    special: ViewSpecial | null;
    alternatives?: ViewDish[];
  } | null
> {
  const r = restaurantById(id);
  if (!r) return null;
  if (r.acceptsOrders) {
    const menu = await getMenu();
    // The manager can close the restaurant (Close Day) — when the backend
    // reports closed, present it as not accepting orders so the existing
    // closed banner shows and the cart is hidden.
    const restaurant = menu.closed ? { ...toViewRestaurant(r), acceptsOrders: false } : toViewRestaurant(r);
    return {
      restaurant,
      dishes: menu.dishes,
      categories: menu.categories,
      special: menu.special ? { dishId: menu.special.dishId, reason: menu.special.reason } : null,
    };
  }
  // Browse-only showcase restaurant
  const dishes: ViewDish[] = (r.dishes ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
    category: "Menu",
    price: d.price,
    image: d.image,
    tastes: d.tastes,
    allergens: [],
    vegetarian: null,
    modifiers: [],
    servingsLeft: null,
    status: "available",
  }));
  return { restaurant: toViewRestaurant(r), dishes, categories: ["Menu"], special: null, alternatives: await alternativesFor(dishes) };
}

/** Closed restaurant → the open Trattoria dishes closest in taste to what this place serves. */
async function alternativesFor(showcase: ViewDish[]): Promise<ViewDish[]> {
  const counts = new Map<Taste, number>();
  for (const d of showcase) for (const t of d.tastes) counts.set(t, (counts.get(t) ?? 0) + 1);
  const menu = await getMenu();
  return menu.dishes
    .filter((d) => d.category !== "Beverage" && allowedFor(d, []))
    .map((d) => ({ d, score: d.tastes.reduce((s, t) => s + (counts.get(t) ?? 0), 0) }))
    .sort((a, b) => b.score - a.score || a.d.price - b.d.price)
    .slice(0, 3)
    .map((x) => x.d);
}
