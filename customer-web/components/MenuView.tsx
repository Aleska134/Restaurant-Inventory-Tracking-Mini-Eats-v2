"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Allergen, ViewDish, ViewRestaurant, ViewSpecial } from "@/lib/types";
import { avoidConflicts } from "@/lib/diet";
import { useApp } from "./AppProvider";
import { DemoFooter, Header } from "./Header";
import { CartBar, CartSheet, type CartPreset } from "./Cart";
import { CloseButton, DishImage, Sheet, Stepper } from "./ui";
import { CATEGORY_LABELS } from "@/lib/content";
import { Gate } from "./Gate";
import { ForYou } from "./ForYou";
import { GroupEntry } from "./GroupOrder";
import { VOICE_ENABLED, VoiceAssistant } from "./VoiceAssistant";
import { useLiveMenu } from "./useLiveMenu";

export function MenuView({
  restaurant,
  dishes: initialDishes,
  categories,
  special: initialSpecial,
  alternatives,
}: {
  restaurant: ViewRestaurant;
  dishes: ViewDish[];
  categories: string[];
  special: ViewSpecial | null;
  alternatives?: ViewDish[];
}) {
  const { t, L, cart, customer, setTastesOpen } = useApp();
  // Live sync: poll the backend so 86 / reorder / chef-special / Close Day show
  // without a page refresh. Seeded by the server render (no empty flash).
  // Browse-only showcase restaurants (acceptsOrders=false in config) never poll.
  const live = useLiveMenu(
    { dishes: initialDishes, special: initialSpecial, closed: !restaurant.acceptsOrders },
    restaurant.acceptsOrders ? 5000 : 1_000_000,
  );
  const dishes = restaurant.acceptsOrders ? live.dishes : initialDishes;
  const special = restaurant.acceptsOrders ? live.special : initialSpecial;
  // A config-closed showcase restaurant stays closed; an orderable one closes
  // live when the manager runs Close Day.
  const canOrder = restaurant.acceptsOrders && !live.closed;
  const [openDish, setOpenDish] = useState<ViewDish | null>(null);
  const [hideConflicts, setHideConflicts] = useState(false);
  const avoid = useMemo(() => (canOrder ? customer?.taste?.avoid ?? [] : []), [canOrder, customer]);
  const conflictCount = dishes.filter((d) => avoidConflicts(d, avoid).length).length;
  const [cartOpen, setCartOpen] = useState(false);
  const [cartPreset, setCartPreset] = useState<CartPreset | null>(null);
  const specialDish = special ? dishes.find((d) => d.id === special.dishId) : undefined;
  const closeDish = useCallback(() => setOpenDish(null), []);
  const closeCart = useCallback(() => setCartOpen(false), []);

  // Deep links from other pages (suggestions, voice on the home page):
  //   ?dish=MENU-006                         opens that dish
  //   ?cart=open&fulfillment=to_go&table=4   opens the cart with "to go / for here" and table preset
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const d = dishes.find((x) => x.id === q.get("dish"));
    if (d) setOpenDish(d);
    if (q.get("cart") === "open" && canOrder) {
      const f = q.get("fulfillment");
      setCartPreset({ fulfillment: f === "to_go" || f === "for_here" ? f : null, table: q.get("table") });
      setCartOpen(true);
    }
    if (q.has("dish") || q.has("cart")) window.history.replaceState(null, "", window.location.pathname);
  }, [dishes, canOrder]);

  const byCategory = useMemo(
    () =>
      categories
        .map((c) => ({
          c,
          // Available first, then dishes that clash with what the customer avoids, sold out last
          items: dishes
            .filter((d) => d.category === c && !(hideConflicts && avoidConflicts(d, avoid).length))
            .sort((a, b) => rank(a) - rank(b)),
        }))
        .filter((g) => g.items.length),
    [categories, dishes, avoid, hideConflicts],
  );
  function rank(d: ViewDish) {
    return d.status === "sold_out" ? 2 : avoidConflicts(d, avoid).length ? 1 : 0;
  }

  return (
    <Gate>
      <Header />
      <main className={`mx-auto max-w-5xl pb-32 ${cart.length && canOrder ? "pb-32" : ""}`}>
        {/* Hero */}
        <section className="relative">
          <DishImage src={restaurant.cover} alt={restaurant.name} ratio="16/9" className="max-h-[360px] w-full sm:rounded-b-3xl" eager dim={!canOrder} />
          <div className="absolute inset-0 bg-gradient-to-t from-night/85 via-night/30 to-transparent sm:rounded-b-3xl" />
          <div className="absolute inset-x-0 bottom-0 px-4 pb-4 text-white sm:px-6 sm:pb-6">
            <div className="flex flex-wrap items-center gap-2">
              {canOrder ? (
                <span className="chip bg-fresh text-white">● {t("home.openNow")}</span>
              ) : (
                <span className="chip bg-white text-night">{t("home.closed")}</span>
              )}
              <span className="chip bg-white/15 text-white backdrop-blur">
                {L(restaurant.cuisine)} · {restaurant.neighborhood}
              </span>
              {canOrder && restaurant.prepMinutes && (
                <span className="chip bg-white/15 text-white backdrop-blur">⏱ {t("home.readyIn", { min: restaurant.prepMinutes })}</span>
              )}
            </div>
            <h1 className="mt-2 text-3xl font-black sm:text-4xl">{restaurant.name}</h1>
            <p className="text-white/85">{L(restaurant.tagline)}</p>
          </div>
        </section>

        {!canOrder && (
          <div className="mx-4 mt-4 rounded-2xl border border-gold/30 bg-gold-tint px-4 py-3 text-sm font-semibold text-gold-text sm:mx-6">
            🌙 {t("menu.closedBanner")}
          </div>
        )}

        {/* Category tabs */}
        {byCategory.length > 1 && (
        <nav className="no-scrollbar sticky top-[57px] z-20 mt-4 flex gap-2 overflow-x-auto bg-cream/95 px-4 py-2 backdrop-blur sm:px-6">
          {byCategory.map(({ c }) => (
            <a key={c} href={`#cat-${c}`} className="btn-ghost shrink-0 px-4 py-1.5 text-sm">
              {CATEGORY_LABELS[c] ? L(CATEGORY_LABELS[c]) : c}
            </a>
          ))}
        </nav>
        )}

        {canOrder && avoid.length > 0 && (
          <div className="mx-4 mt-4 flex flex-wrap items-center gap-2 rounded-2xl bg-fresh-tint px-4 py-3 text-sm sm:mx-6">
            <span className="font-semibold text-fresh">
              🛡 {t("diet.avoiding")}: {avoid.map((a) => t(`allergen.${a}` as never)).join(" · ")}
            </span>
            <span className="text-ink-soft">{t("diet.count", { n: conflictCount })}</span>
            <span className="ml-auto flex gap-2">
              {conflictCount > 0 && (
                <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => setHideConflicts((v) => !v)}>
                  {hideConflicts ? t("diet.showAll") : t("diet.hide")}
                </button>
              )}
              <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => setTastesOpen(true)}>
                {t("diet.edit")}
              </button>
            </span>
          </div>
        )}

        {canOrder && <GroupEntry />}

        {canOrder && <ForYou dishes={dishes} onOpen={setOpenDish} />}

        {/* Chef's special (FR-8 overstock) */}
        {canOrder && specialDish && special && (
          <section className="px-4 pt-4 sm:px-6">
            <button
              type="button"
              onClick={() => setOpenDish(specialDish)}
              className="card flex w-full flex-col text-left transition hover:-translate-y-0.5 sm:flex-row"
            >
              <DishImage src={specialDish.image} alt={L(specialDish.name)} className="sm:w-2/5" />
              <div className="flex flex-1 flex-col justify-center gap-2 p-5">
                <span className="chip w-fit bg-gold text-night">★ {t("special.badge")}</span>
                <h2 className="text-2xl font-black text-night">{L(specialDish.name)}</h2>
                <p className="text-ink-soft">{L(specialDish.description)}</p>
                <p className="rounded-xl bg-cream px-3 py-2 text-sm text-ink-soft">
                  <b className="text-ink">{t("special.why")}</b> {L(special.reason)}
                </p>
                <PriceTag value={specialDish.price} />
              </div>
            </button>
          </section>
        )}

        {byCategory.map(({ c, items }) => (
          <section key={c} id={`cat-${c}`} className="scroll-mt-32 px-4 pt-8 sm:px-6">
            <h2 className="mb-3 text-xl font-black text-night">{CATEGORY_LABELS[c] ? L(CATEGORY_LABELS[c]) : c}</h2>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
              {items.map((d) => (
                <DishCard key={d.id} dish={d} onOpen={() => setOpenDish(d)} special={d.id === special?.dishId && canOrder} dim={!canOrder} conflicts={avoidConflicts(d, avoid)} />
              ))}
            </div>
          </section>
        ))}

        {!canOrder && alternatives && alternatives.length > 0 && (
          <section className="px-4 pt-10 sm:px-6">
            <div className="rounded-3xl bg-white p-4 shadow-card sm:p-6">
              <h2 className="text-lg font-black text-night">
                <span className="text-gold">✨</span> {t("ai.closedTip", { restaurant: restaurant.name })}
              </h2>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {alternatives.map((d) => (
                  <Link key={d.id} href={`/r/trattoria-little-italy?dish=${d.id}`} className="card block transition hover:-translate-y-0.5">
                    <DishImage src={d.image} alt={L(d.name)} eager />
                    <div className="p-3">
                      <p className="font-bold text-night">{L(d.name)}</p>
                      <p className="text-sm text-ink-soft">Trattoria Little Italy</p>
                    </div>
                  </Link>
                ))}
              </div>
              <Link href="/r/trattoria-little-italy" className="btn-gold mt-4 w-full">
                🍝 Trattoria Little Italy — {t("home.orderNow")}
              </Link>
            </div>
          </section>
        )}
        <DemoFooter />
      </main>

      <DishSheet dish={openDish} canOrder={canOrder} onClose={closeDish} />
      {canOrder && <CartBar onOpen={() => setCartOpen(true)} />}
      {canOrder && VOICE_ENABLED && (
        <VoiceAssistant
          dishes={dishes}
          onOpenDish={setOpenDish}
          onReviewCart={(p) => {
            setCartPreset(p);
            setCartOpen(true);
          }}
        />
      )}
      {canOrder && <CartSheet open={cartOpen} onClose={closeCart} restaurantName={restaurant.name} preset={cartPreset} />}
    </Gate>
  );
}

function PriceTag({ value }: { value: number }) {
  const { price } = useApp();
  return <span className="text-lg font-black text-gold-text">{price(value)}</span>;
}

export function DishCard({
  dish,
  onOpen,
  special = false,
  dim = false,
  badge,
  conflicts = [],
}: {
  dish: ViewDish;
  onOpen: () => void;
  special?: boolean;
  dim?: boolean;
  badge?: string;
  conflicts?: Allergen[];
}) {
  const { L, t, price } = useApp();
  const soldOut = dish.status === "sold_out";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`card group flex flex-col text-left transition hover:-translate-y-0.5 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-gold ${
        soldOut ? "opacity-60" : conflicts.length ? "opacity-75" : ""
      }`}
    >
      <div className="relative">
        <DishImage src={dish.image} alt={L(dish.name)} dim={dim || soldOut} />
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          {badge && <span className="chip bg-night text-white">✨ {badge}</span>}
          {special && <span className="chip bg-gold text-night">★ {t("special.badge")}</span>}
          {soldOut && <span className="chip bg-night text-white">{t("menu.soldOut")}</span>}
          {dish.status === "low" && <span className="chip bg-warn text-white">{t("menu.onlyLeft", { n: dish.servingsLeft ?? 0 })}</span>}
          {conflicts.length > 0 && (
            <span className="chip bg-warn text-white">⚠ {conflicts.map((a) => t(`allergen.${a}` as never)).join(" · ")}</span>
          )}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3 sm:p-4">
        <h3 className="font-bold leading-snug text-night">{L(dish.name)}</h3>
        <p className="line-clamp-2 text-sm text-ink-soft">{L(dish.description)}</p>
        <div className="mt-auto flex items-center justify-between pt-2">
          <span className="font-black text-gold-text">{price(dish.price)}</span>
          {!dim && !soldOut && (
            <span className="grid h-8 w-8 place-items-center rounded-full bg-gold text-lg font-black text-night transition group-hover:scale-110" aria-hidden>
              +
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function DishSheet({ dish, canOrder, onClose }: { dish: ViewDish | null; canOrder: boolean; onClose: () => void }) {
  // Keep the last dish while the close animation runs.
  const [shown, setShown] = useState<ViewDish | null>(dish);
  if (dish && dish !== shown) setShown(dish);
  return (
    <Sheet open={!!dish} onClose={onClose} label={shown ? shown.name.en : ""}>
      {shown && <DishDetail key={shown.id} dish={shown} canOrder={canOrder} onDone={onClose} />}
    </Sheet>
  );
}

function DishDetail({ dish, canOrder, onDone }: { dish: ViewDish; canOrder: boolean; onDone: () => void }) {
  const { L, t, price, addToCart, customer } = useApp();
  const conflicts = canOrder ? avoidConflicts(dish, customer?.taste?.avoid ?? []) : [];
  const [qty, setQty] = useState(1);
  const [mods, setMods] = useState<string[]>([]);
  const unit = dish.price + dish.modifiers.filter((m) => mods.includes(m.id)).reduce((s, m) => s + m.price, 0);
  const soldOut = dish.status === "sold_out";

  function toggle(id: string) {
    setMods((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      const next = [...cur, id];
      // extra_cheese and no_cheese are mutually exclusive
      if (id === "extra_cheese") return next.filter((x) => x !== "no_cheese");
      if (id === "no_cheese") return next.filter((x) => x !== "extra_cheese");
      return next;
    });
  }

  function add() {
    addToCart({
      menuItemId: dish.id,
      name: dish.name,
      image: dish.image,
      unitPrice: unit,
      quantity: qty,
      modifiers: [...mods].sort(),
      modifierLabels: dish.modifiers.filter((m) => mods.includes(m.id)).map((m) => m.label),
    });
    onDone();
  }

  return (
    <div>
      <div className="relative">
        <DishImage src={dish.image} alt={L(dish.name)} ratio="16/9" eager dim={!canOrder} />
        <CloseButton onClick={onDone} className="absolute right-3 top-3" />
        <div className="absolute left-1/2 top-2 h-1.5 w-12 -translate-x-1/2 rounded-full bg-white/80 sm:hidden" aria-hidden />
      </div>
      <div className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-2xl font-black text-night">{L(dish.name)}</h2>
          <span className="pt-1 text-xl font-black text-gold-text">{price(dish.price)}</span>
        </div>
        <p className="text-ink-soft">{L(dish.description)}</p>

        <div className="flex flex-wrap gap-1.5">
          {dish.vegetarian && <span className="chip bg-fresh-tint text-fresh">🌱 {t("menu.vegetarian")}</span>}
          {dish.status === "low" && <span className="chip bg-warn-tint text-warn">{t("menu.onlyLeft", { n: dish.servingsLeft ?? 0 })}</span>}
          {soldOut && <span className="chip bg-night text-white">{t("menu.soldOut")}</span>}
          {dish.tastes.slice(0, 3).map((x) => (
            <span key={x} className="chip bg-cream text-ink-soft">
              {t(`taste.${x}` as never)}
            </span>
          ))}
        </div>

        {conflicts.length > 0 && (
          <p className="rounded-xl bg-warn-tint p-3 text-sm font-semibold text-warn" role="note">
            ⚠ {t("diet.warn", { items: conflicts.map((a) => t(`allergen.${a}` as never)).join(" · ") })}
          </p>
        )}

        {dish.allergens.length > 0 && (
          <div className="rounded-xl bg-cream p-3 text-sm">
            <b>{t("menu.contains")}:</b> {dish.allergens.map((a) => t(`allergen.${a}` as never)).join(" · ")}
            <p className="mt-1 text-xs text-ink-faint">{t("menu.allergenNote")}</p>
          </div>
        )}

        {canOrder && dish.modifiers.length > 0 && (
          <fieldset>
            <legend className="mb-2 text-sm font-bold">{t("menu.options")}</legend>
            <div className="space-y-2">
              {dish.modifiers.map((m) => (
                <label
                  key={m.id}
                  className={`flex cursor-pointer items-center justify-between rounded-xl border px-4 py-3 transition ${
                    mods.includes(m.id) ? "border-gold bg-gold-tint" : "border-line"
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <input type="checkbox" checked={mods.includes(m.id)} onChange={() => toggle(m.id)} className="h-4 w-4 accent-[#A57F00]" />
                    {L(m.label)}
                  </span>
                  <span className="text-sm text-ink-soft">{m.price ? `+${price(m.price)}` : ""}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {canOrder ? (
          <div className="sticky bottom-0 -mx-5 -mb-5 flex items-center gap-3 border-t border-line bg-white p-4">
            <Stepper value={qty} onChange={setQty} min={1} max={Math.min(20, dish.servingsLeft ?? 20)} label={t("menu.quantity")} />
            <button type="button" className="btn-gold flex-1" disabled={soldOut} onClick={add}>
              {soldOut ? t("menu.soldOut") : t("menu.addToOrder", { price: price(unit * qty) })}
            </button>
          </div>
        ) : (
          <p className="rounded-xl bg-gold-tint px-4 py-3 text-center text-sm font-bold text-gold-text">🌙 {t("home.opensAt")}</p>
        )}
      </div>
    </div>
  );
}
