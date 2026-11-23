import { beforeEach, describe, expect, it, vi } from "vitest";
import { MENU } from "./fixtures";

// The model is replaced by a stub: each test says what "Claude" answered, and checks what the
// code does with it. The rule under test: the model only proposes, code decides what goes in the cart.
const ai = vi.hoisted(() => ({ answer: null as unknown, fail: false, calls: 0 }));
vi.mock("@/lib/ai", () => ({
  aiProvider: () => "claude",
  structured: async () => {
    ai.calls++;
    if (ai.fail) throw new Error("rate limited");
    return ai.answer;
  },
}));
vi.mock("@/lib/catalog", () => ({ getMenu: async () => ({ dishes: MENU, categories: [], special: null }) }));

import { cleanHistory, interpret } from "@/lib/voice";

const said = (over: Record<string, unknown>) => ({
  intent: "add_to_order",
  items: [],
  budget: 0,
  avoid: [],
  fulfillment: "unspecified",
  tableNumber: "",
  matches: [],
  reply: "Added. Review your order before you confirm.",
  ...over,
});

beforeEach(() => {
  ai.answer = null;
  ai.fail = false;
  ai.calls = 0;
});

describe("voice order → cart", () => {
  it("keeps only real, orderable dishes, with sane quantities", async () => {
    ai.answer = said({
      items: [
        { dishId: "PIZZA", quantity: 2 },
        { dishId: "PIZZA", quantity: 1 }, // same dish twice: merged
        { dishId: "INVENTED", quantity: 1 }, // not on the menu
        { dishId: "GONE", quantity: 1 }, // sold out
        { dishId: "COKE", quantity: 0 }, // "a coke": at least one
        { dishId: "SALAD", quantity: 999 }, // capped at 20
        { dishId: "CHICKEN", quantity: 5 }, // only 3 servings left
      ],
    });
    const r = await interpret("two pizzas, another pizza, a coke…", "en");
    expect(r.intent).toBe("add_to_order");
    expect(r.items).toEqual([
      { dishId: "PIZZA", quantity: 3 },
      { dishId: "COKE", quantity: 1 },
      { dishId: "SALAD", quantity: 20 },
      { dishId: "CHICKEN", quantity: 3 },
    ]);
  });

  it("reads to go / for here and cleans the table number", async () => {
    ai.answer = said({ items: [{ dishId: "PIZZA", quantity: 1 }], fulfillment: "for_here", tableNumber: " 12<script> " });
    const r = await interpret("one pizza for table 12", "en");
    expect(r.fulfillment).toBe("for_here");
    expect(r.tableNumber).toBe("12script");
    ai.answer = said({ items: [{ dishId: "PIZZA", quantity: 1 }] });
    expect((await interpret("one pizza", "en")).fulfillment).toBeNull();
  });

  it("never fills the cart when the customer asked for a recommendation", async () => {
    ai.answer = said({ items: [{ dishId: "SALAD", quantity: 1 }], matches: ["PIZZA"] });
    const r = await interpret("what do you recommend?", "en");
    expect(r.intent).toBe("find_dish");
    expect(r.items).toEqual([]);
    expect(r.matches.map((m) => m.dishId)).toEqual(["SALAD", "PIZZA"]);
  });

  it("shows choices instead of guessing when nothing clear was named", async () => {
    ai.answer = said({ items: [{ dishId: "INVENTED", quantity: 1 }], matches: ["PIZZA", "CARBONARA"], reply: "Did you mean the pizza or the carbonara?" });
    const r = await interpret("the special one", "en");
    expect(r.intent).toBe("find_dish");
    expect(r.items).toEqual([]);
    expect(r.matches.map((m) => m.dishId)).toEqual(["PIZZA", "CARBONARA"]);
  });

  it("marks dishes from restaurants that are closed", async () => {
    ai.answer = said({ intent: "find_dish", matches: ["la-ventanita-calle-8:cafecito", "SALAD", "nope"] });
    const r = await interpret("where can I get a cafecito?", "en");
    expect(r.matches).toMatchObject([
      { dishId: "cafecito", restaurantId: "la-ventanita-calle-8", open: false },
      { dishId: "SALAD", open: true },
    ]);
  });
});

describe("voice: building a meal", () => {
  it("drops what the customer avoids, even if the model picked it", async () => {
    ai.answer = said({
      intent: "build_meal",
      items: [
        { dishId: "CARBONARA", quantity: 1 }, // pork
        { dishId: "SALAD", quantity: 1 },
      ],
      avoid: ["pork"],
    });
    const r = await interpret("dinner, no pork", "en");
    expect(r.items).toEqual([{ dishId: "SALAD", quantity: 1 }]);
    // The model's reply could describe the carbonara, so it is replaced.
    expect(r.reply).toMatch(/fits your budget and what you avoid/);
  });

  it("also respects the avoid list saved in the profile", async () => {
    ai.answer = said({ intent: "build_meal", items: [{ dishId: "PIZZA", quantity: 1 }, { dishId: "SALAD", quantity: 1 }] });
    const r = await interpret("something for lunch", "en", ["gluten"]);
    expect(r.items).toEqual([{ dishId: "SALAD", quantity: 1 }]);
  });

  it("trims from the least important end until it fits the budget, and computes the total itself", async () => {
    ai.answer = said({
      intent: "build_meal",
      items: [
        { dishId: "PIZZA", quantity: 2 }, // 31.98
        { dishId: "TIRAMISU", quantity: 2 }, // 17.98
      ],
      budget: 42,
      reply: "A feast for two, only $20!", // a price the code must not trust
    });
    const r = await interpret("dinner for two under 42 dollars", "en");
    expect(r.items).toEqual([
      { dishId: "PIZZA", quantity: 2 },
      { dishId: "TIRAMISU", quantity: 1 },
    ]);
    expect(r.total).toBe(40.97);
    expect(r.budget).toBe(42);
    expect(r.reply).not.toContain("$20");
  });

  it("says so when nothing fits", async () => {
    ai.answer = said({ intent: "build_meal", items: [{ dishId: "CHICKEN", quantity: 1 }], budget: 5 });
    const r = await interpret("dinner under 5 dollars", "es");
    expect(r.items).toEqual([]);
    expect(r.intent).toBe("unknown");
    expect(r.total).toBeNull();
    expect(r.reply).toMatch(/nada del menú cabe/);
  });
});

describe("voice: when things go wrong", () => {
  it("answers politely if the AI is unavailable", async () => {
    ai.fail = true;
    const r = await interpret("two pizzas", "es");
    expect(r.items).toEqual([]);
    expect(r.reply).toMatch(/no está disponible/);
  });

  it("falls back to an example sentence if the model returns nothing", async () => {
    ai.answer = null;
    const r = await interpret("mmm", "en");
    expect(r.intent).toBe("unknown");
    expect(r.reply).toMatch(/couldn't understand/);
  });

  it("shortens a long reply by whole sentences, never cutting one in half", async () => {
    const long = "First sentence is fine. " + "This second sentence goes on and on ".repeat(8) + "end.";
    // the first call answers the order, the rewrite call returns something still too long
    ai.answer = said({ items: [{ dishId: "PIZZA", quantity: 1 }], reply: long });
    const r = await interpret("a pizza", "en");
    expect(r.reply).toBe("First sentence is fine.");
    expect(ai.calls).toBe(2);
  });
});

describe("conversation history from the browser", () => {
  it("keeps only the last two turns, and only well-formed fields", () => {
    const turns = cleanHistory([
      { said: "old", reply: "x", proposed: [], added: [] },
      { said: "hi", reply: 5, proposed: ["A", 7, "B"], added: [{ dishId: "A", quantity: 99 }, { dishId: 3, quantity: 1 }, { dishId: "B", quantity: -1 }] },
      { said: "x".repeat(500), reply: "r" },
      { reply: "no said" },
    ]);
    expect(turns).toHaveLength(1); // the last two entries; the very last has no "said", so it is dropped
    expect(turns[0].said).toHaveLength(300);
    expect(cleanHistory([{ said: "hi", reply: 5, proposed: ["A", 7], added: [{ dishId: "A", quantity: 99 }, { dishId: 3, quantity: 1 }] }])).toEqual([
      { said: "hi", reply: "5", proposed: ["A"], added: [{ dishId: "A", quantity: 20 }] },
    ]);
    expect(cleanHistory("not a list")).toEqual([]);
  });
});
