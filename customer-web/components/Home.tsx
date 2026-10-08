"use client";

import Link from "next/link";
import type { Localized } from "@/lib/content";
import type { ViewDish, ViewRestaurant } from "@/lib/types";
import { useApp } from "./AppProvider";
import { DemoFooter, Header } from "./Header";
import { Gate } from "./Gate";
import { DishImage } from "./ui";

export function Home({
  restaurants,
  special,
}: {
  restaurants: ViewRestaurant[];
  special: { dish: ViewDish; reason: Localized } | null;
  dishes: ViewDish[];
}) {
  const { t, L, price, customer } = useApp();
  const open = restaurants.filter((r) => r.acceptsOrders);
  const closed = restaurants.filter((r) => !r.acceptsOrders);

  return (
    <Gate>
      <Header />
      <main className="mx-auto max-w-5xl px-4 pb-10 pt-6 sm:px-6">
        <h1 className="text-3xl font-black text-night">{t("home.hi", { name: customer?.name ?? "" })} 👋</h1>
        <p className="text-ink-soft">{t("home.subtitle")}</p>


        {open.map((r) => (
          <Link
            key={r.id}
            href={`/r/${r.id}`}
            className="card group mt-6 block transition hover:-translate-y-0.5 hover:shadow-lg sm:grid sm:grid-cols-5"
          >
            {/* Phone: photo on top. Tablet/desktop: photo left, details right, so the card stays compact. */}
            <div className="relative sm:col-span-2">
              <DishImage src={r.cover} alt={r.name} ratio="16/9" eager className="sm:h-full sm:min-h-[260px] sm:!aspect-auto" />
              <div className="absolute left-3 top-3 flex gap-2">
                <span className="chip bg-fresh text-white">● {t("home.openNow")}</span>
                {r.prepMinutes && <span className="chip bg-white text-night">⏱ {t("home.readyIn", { min: r.prepMinutes })}</span>}
              </div>
            </div>
            <div className="flex flex-col justify-center sm:col-span-3 sm:py-2">
            <div className="px-4 pt-4 sm:px-6">
              <p className="text-xs font-black uppercase tracking-wider text-gold-text">
                {L(r.cuisine)} · {r.neighborhood}
              </p>
              <h2 className="text-2xl font-black text-night sm:text-3xl">{r.name}</h2>
              <p className="text-ink-soft">{L(r.tagline)}</p>
            </div>
            {special && (
              <div className="mx-4 mt-4 flex items-center gap-3 rounded-2xl bg-cream p-3 sm:mx-6">
                <DishImage src={special.dish.image} alt="" ratio="1/1" className="w-16 shrink-0 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <span className="chip bg-gold text-night">★ {t("special.badge")}</span>
                  <p className="mt-1 truncate font-bold text-night">
                    {L(special.dish.name)} · <span className="text-gold-text">{price(special.dish.price)}</span>
                  </p>
                  <p className="line-clamp-1 text-sm text-ink-soft">{L(special.reason)}</p>
                </div>
              </div>
            )}
            <div className="p-4 sm:px-6">
              <span className="btn-gold w-full sm:w-auto">{t("home.orderNow")} →</span>
            </div>
            </div>
          </Link>
        ))}

        <section className="mt-10">
          <h2 className="text-xl font-black text-night">{t("home.moreOnBarmade")}</h2>
          <p className="text-sm text-ink-soft">{t("home.moreSubtitle")}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {closed.map((r) => (
              <Link key={r.id} href={`/r/${r.id}`} className="card group block transition hover:-translate-y-0.5">
                <div className="relative">
                  <DishImage src={r.cover} alt={r.name} dim />
                  <div className="absolute inset-0 bg-night/35" />
                  <span className="chip absolute left-3 top-3 bg-white text-night">🌙 {t("home.closed")}</span>
                </div>
                <div className="p-4">
                  <h3 className="font-black text-night">{r.name}</h3>
                  <p className="text-sm text-ink-soft">
                    {L(r.cuisine)} · {r.neighborhood}
                  </p>
                  <p className="mt-2 text-xs font-bold text-gold-text">{t("home.opensAt")}</p>
                  <p className="mt-3 text-sm font-bold text-night group-hover:text-gold-text">{t("home.browseMenu")} →</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
        <DemoFooter />
      </main>
    </Gate>
  );
}
