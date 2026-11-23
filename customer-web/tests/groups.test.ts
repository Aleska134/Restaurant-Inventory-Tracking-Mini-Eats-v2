import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MenuRow } from "@/lib/catalog";

// Group orders run on the in-memory store (no Firestore). The menu prices are fixed
// here and the kitchen order is a stub, so the tests check the bill and the rules only.
const ROWS: MenuRow[] = [
  { id: "PIZZA", key: "pizza", name: "Pizza", price: 15.99, category: "Pizza", modifierIds: ["extra_cheese", "no_cheese"], ingredients: [] },
  { id: "COKE", key: "coke", name: "Coke", price: 2.99, category: "Beverage", modifierIds: [], ingredients: [] },
  { id: "TEN", key: "ten", name: "Ten", price: 10, category: "Entree", modifierIds: [], ingredients: [] },
  { id: "OFF", key: "off", name: "Off", price: 5, category: "Entree", modifierIds: [], ingredients: [], active: false },
];
const kitchen = vi.hoisted(() => ({ orders: [] as unknown[], fail: false }));

vi.mock("@/lib/store/firestore", () => ({ firestoreConfigured: () => false, firestore: () => { throw new Error("no firestore in tests"); } }));
vi.mock("@/lib/catalog", () => ({
  loadCatalog: async () => ({ rows: ROWS, stock: new Map(), live: false }),
  menuItem: (c: { rows: MenuRow[] }, id: string) => c.rows.find((r) => r.id === id),
  unitPrice: (row: MenuRow, mods: string[]) => Math.round((row.price + (mods.includes("extra_cheese") ? 2 : 0)) * 100) / 100,
  round2: (n: number) => Math.round(n * 100) / 100,
}));
vi.mock("@/lib/orders", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/orders")>();
  return {
    OrderError: real.OrderError,
    getOrder: async (id: string) => ({ id, order_number: 1001, status: "RECEIVED" }),
    createOrder: async (input: unknown) => {
      if (kitchen.fail) throw new real.OrderError("sold_out", "Pizza is sold out");
      kitchen.orders.push(input);
      return { id: `order-${kitchen.orders.length}` };
    },
  };
});

import { createGroup, getGroup, joinGroup, placeGroup, setMyItems, setOptions, setPaid } from "@/lib/groups";

const owes = (g: Awaited<ReturnType<typeof createGroup>>) => g.bill.perMember.map((m) => m.owes);

beforeEach(() => {
  kitchen.orders.length = 0;
  kitchen.fail = false;
});

async function groupOf(n: number) {
  const g = await createGroup("host", "Ana");
  for (let i = 1; i < n; i++) await joinGroup(g.code, `friend${i}`, `Friend ${i}`);
  return g.code;
}

describe("group bill", () => {
  it("each pays their own dishes by default", async () => {
    const code = await groupOf(2);
    await setMyItems(code, "host", [{ menuItemId: "PIZZA", quantity: 1, modifiers: ["extra_cheese"] }]);
    const g = await setMyItems(code, "friend1", [{ menuItemId: "COKE", quantity: 2, modifiers: [] }]);
    expect(owes(g)).toEqual([17.99, 5.98]);
    expect(g.bill.total).toBe(23.97);
  });

  it("splits equally in cents, and the cents add up exactly", async () => {
    const code = await groupOf(3);
    await setMyItems(code, "host", [{ menuItemId: "TEN", quantity: 1, modifiers: [] }]);
    const g = await setOptions(code, "host", { split: "equal" });
    // $10.00 for 3: someone pays the extra cent, nobody pays $3.333…
    expect(owes(g)).toEqual([3.34, 3.33, 3.33]);
    const cents = owes(g).reduce((s, x) => s + Math.round(x * 100), 0);
    expect(cents).toBe(1000);
  });

  it("a split of odd totals among many people still adds up", async () => {
    const code = await groupOf(7);
    await setMyItems(code, "host", [{ menuItemId: "PIZZA", quantity: 3, modifiers: [] }]); // 47.97
    await setMyItems(code, "friend3", [{ menuItemId: "COKE", quantity: 1, modifiers: [] }]); // 2.99
    const g = await setOptions(code, "host", { split: "equal" });
    const cents = owes(g).map((x) => Math.round(x * 100));
    expect(cents.reduce((a, b) => a + b, 0)).toBe(5096);
    expect(Math.max(...cents) - Math.min(...cents)).toBeLessThanOrEqual(1);
  });
});

describe("what each person can add", () => {
  it("keeps only real dishes, valid quantities and allowed extras, and merges repeats", async () => {
    const code = await groupOf(1);
    const g = await setMyItems(code, "host", [
      { menuItemId: "PIZZA", quantity: 2, modifiers: ["extra_cheese", "add_chicken"] }, // chicken isn't offered on pizza
      { menuItemId: "PIZZA", quantity: 1, modifiers: ["extra_cheese"] }, // same as above: merged
      { menuItemId: "INVENTED", quantity: 1, modifiers: [] },
      { menuItemId: "OFF", quantity: 1, modifiers: [] }, // not offered right now
      { menuItemId: "COKE", quantity: 0, modifiers: [] },
      { menuItemId: "COKE", quantity: 50, modifiers: [] }, // capped
      "garbage",
    ]);
    expect(g.members[0].items).toEqual([
      { menuItemId: "PIZZA", quantity: 3, modifiers: ["extra_cheese"] },
      { menuItemId: "COKE", quantity: 20, modifiers: [] },
    ]);
  });

  it("needs a name to join, joining twice is harmless, and groups have a limit", async () => {
    const code = await groupOf(1);
    await expect(joinGroup(code, "x", "   ")).rejects.toThrow(/required/);
    await joinGroup(code, "friend", "Bea");
    const again = await joinGroup(code, "friend", "Bea");
    expect(again.members).toHaveLength(2);
    for (let i = 0; i < 10; i++) await joinGroup(code, `p${i}`, `P${i}`);
    await expect(joinGroup(code, "late", "Late")).rejects.toThrow(/limited to 12/);
  });

  it("you must join before adding dishes", async () => {
    const code = await groupOf(1);
    await expect(setMyItems(code, "stranger", [])).rejects.toThrow(/Join the group first/);
  });
});

describe("only the host decides", () => {
  it("guests cannot change the split, mark payments or send the order", async () => {
    const code = await groupOf(2);
    await expect(setOptions(code, "friend1", { split: "equal" })).rejects.toThrow(/Only the host/);
    await expect(setPaid(code, "friend1", "friend1", true)).rejects.toThrow(/Only the host/);
    await expect(placeGroup(code, "friend1")).rejects.toThrow(/Only the host/);
    const g = await setPaid(code, "host", "friend1", true);
    expect(g.bill.perMember[1].paid).toBe(true);
  });

  it("cleans the table number", async () => {
    const code = await groupOf(1);
    const g = await setOptions(code, "host", { fulfillment: "to_go", tableNumber: "7 <b>" });
    expect(g.fulfillment).toBe("to_go");
    expect(g.tableNumber).toBe("7b");
  });
});

describe("sending the group order", () => {
  it("sends everyone's dishes to the kitchen as ONE order", async () => {
    const code = await groupOf(3);
    await setMyItems(code, "host", [{ menuItemId: "PIZZA", quantity: 1, modifiers: [] }]);
    await setMyItems(code, "friend1", [{ menuItemId: "PIZZA", quantity: 2, modifiers: [] }, { menuItemId: "COKE", quantity: 1, modifiers: [] }]);
    const g = await placeGroup(code, "host");
    expect(kitchen.orders).toHaveLength(1);
    expect(kitchen.orders[0]).toMatchObject({
      customerName: "Ana · group of 3",
      items: [
        { menuItemId: "PIZZA", quantity: 3, modifiers: [] },
        { menuItemId: "COKE", quantity: 1, modifiers: [] },
      ],
    });
    expect(g.status).toBe("placed");
    expect(g.order).toMatchObject({ id: "order-1", order_number: 1001 });
  });

  it("cannot be sent twice, and nothing changes after it was sent", async () => {
    const code = await groupOf(2);
    await setMyItems(code, "host", [{ menuItemId: "TEN", quantity: 1, modifiers: [] }]);
    await placeGroup(code, "host");
    await expect(placeGroup(code, "host")).rejects.toThrow(/already sent/);
    await expect(setMyItems(code, "friend1", [])).rejects.toThrow(/already sent/);
    await expect(joinGroup(code, "late", "Late")).rejects.toThrow(/already sent/);
    expect(kitchen.orders).toHaveLength(1);
  });

  it("an empty group cannot be sent", async () => {
    const code = await groupOf(2);
    await expect(placeGroup(code, "host")).rejects.toThrow(/Nobody has added a dish/);
  });

  it("if the kitchen rejects it, the group reopens so they can fix it and retry", async () => {
    const code = await groupOf(1);
    await setMyItems(code, "host", [{ menuItemId: "PIZZA", quantity: 1, modifiers: [] }]);
    kitchen.fail = true;
    await expect(placeGroup(code, "host")).rejects.toThrow(/sold out/);
    expect((await getGroup(code))?.status).toBe("open");
    kitchen.fail = false;
    expect((await placeGroup(code, "host")).status).toBe("placed");
  });

  it("unknown or malformed codes find nothing", async () => {
    expect(await getGroup("ZZZZ")).toBeNull();
    expect(await getGroup("bad code")).toBeNull();
  });
});
