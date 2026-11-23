import { describe, expect, it, vi } from "vitest";
import { MENU, dish } from "./fixtures";

vi.mock("@/lib/ai", () => ({ aiProvider: () => null, structured: async () => null }));
vi.mock("@/lib/catalog", () => ({ getMenu: async () => ({ dishes: MENU, categories: [], special: { dishId: "SALAD" } }) }));

import { avoidConflicts } from "@/lib/diet";
import { allowedFor, recommend, rules } from "@/lib/recommend";

describe("what the customer wants to avoid", () => {
  it("lists the conflicts of a dish", () => {
    expect(avoidConflicts({ allergens: ["dairy", "gluten"], vegetarian: true }, ["gluten", "fish"])).toEqual(["gluten"]);
    expect(avoidConflicts({ allergens: ["dairy"], vegetarian: true }, [])).toEqual([]);
  });

  it("treats 'no meat' as vegetarian only", () => {
    expect(avoidConflicts({ allergens: [], vegetarian: false }, ["meat"])).toEqual(["meat"]);
    expect(avoidConflicts({ allergens: [], vegetarian: true }, ["meat"])).toEqual([]);
    // unknown (null) is not marked as meat: only dishes known to have it
    expect(avoidConflicts({ allergens: [], vegetarian: null }, ["meat"])).toEqual([]);
  });

  it("never allows sold-out dishes or dishes with something to avoid", () => {
    const [pizza, , salad] = MENU;
    expect(allowedFor(salad, [])).toBe(true);
    expect(allowedFor(pizza, ["dairy"])).toBe(false);
    expect(allowedFor(dish({ id: "X", price: 1, category: "Pizza", status: "sold_out" }), [])).toBe(false);
  });
});

describe("suggestions without AI (rules)", () => {
  it("ranks by the tastes the customer likes, with a boost for the chef's special", () => {
    const r = rules({ likes: ["meaty"], avoid: [], lang: "en" }, MENU.slice(0, 5), "SALAD");
    expect(r.source).toBe("rules");
    expect(r.suggestions.map((s) => s.dishId)).toEqual(["CARBONARA", "CHICKEN", "SALAD"]);
    expect(r.suggestions[0].reason).toBe("Matches what you like: meaty.");
  });

  it("keeps variety: at most two dishes of the same category", () => {
    const pastas = [1, 2, 3].map((n) => dish({ id: `PASTA${n}`, price: 10 + n, category: "Pasta", tastes: ["creamy"] }));
    const r = rules({ likes: ["creamy"], avoid: [], lang: "en" }, [...pastas, MENU[2]]);
    expect(r.suggestions.map((s) => s.dishId)).toEqual(["PASTA1", "PASTA2", "SALAD"]);
  });

  it("breaks ties with the cheaper dish and writes reasons in Spanish", () => {
    const r = rules({ likes: [], avoid: [], lang: "es" }, MENU.slice(0, 3));
    expect(r.suggestions[0]).toEqual({ dishId: "SALAD", reason: "Uno de los favoritos de hoy." });
    const es = rules({ likes: ["cheesy"], avoid: [], lang: "es" }, MENU.slice(0, 1));
    expect(es.suggestions[0].reason).toBe("Va con lo que te gusta: con queso.");
  });

  it("only suggests food the customer can eat, in stock, and no drinks", async () => {
    const r = await recommend({ likes: ["cheesy", "savory", "bubbly"], avoid: ["dairy"], lang: "en" });
    const ids = r.suggestions.map((s) => s.dishId);
    expect(ids).not.toContain("PIZZA"); // dairy
    expect(ids).not.toContain("GONE"); // sold out
    expect(ids).not.toContain("COKE"); // beverage
    expect(ids[0]).toBe("CHICKEN"); // savory
  });

  it("with strict restrictions, only the safe dish is left", async () => {
    const r = await recommend({ likes: [], avoid: ["dairy", "gluten", "meat"], lang: "en" });
    expect(r.suggestions.map((s) => s.dishId)).toEqual(["SALAD"]);
  });
});
