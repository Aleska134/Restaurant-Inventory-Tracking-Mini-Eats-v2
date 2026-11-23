import type { Dish } from "@/lib/catalog";

/** A small menu shaped like getMenu() returns it. */
export function dish(over: Partial<Dish> & Pick<Dish, "id" | "price" | "category">): Dish {
  return {
    key: over.id.toLowerCase(),
    name: { en: over.id, es: over.id },
    description: { en: "", es: "" },
    image: `/images/${over.id}.jpg`,
    tastes: [],
    allergens: [],
    vegetarian: true,
    modifiers: [],
    servingsLeft: 50,
    status: "available",
    ...over,
  };
}

export const MENU: Dish[] = [
  dish({ id: "PIZZA", price: 15.99, category: "Pizza", allergens: ["dairy", "gluten"], tastes: ["cheesy", "tomato"] }),
  dish({ id: "CARBONARA", price: 18.99, category: "Pasta", allergens: ["dairy", "gluten", "egg", "pork"], vegetarian: false, tastes: ["creamy", "meaty"] }),
  dish({ id: "SALAD", price: 11.99, category: "Salad", tastes: ["fresh", "light"] }),
  dish({ id: "CHICKEN", price: 22.99, category: "Entree", vegetarian: false, tastes: ["meaty", "savory"], servingsLeft: 3, status: "low" }),
  dish({ id: "TIRAMISU", price: 8.99, category: "Dessert", allergens: ["dairy", "egg", "gluten"], tastes: ["sweet"] }),
  dish({ id: "COKE", price: 2.99, category: "Beverage", tastes: ["bubbly"] }),
  dish({ id: "GONE", price: 9.99, category: "Appetizer", servingsLeft: 0, status: "sold_out", tastes: ["savory"] }),
];
