"use client";

import Link from "next/link";
import { useApp } from "./AppProvider";
import { ActiveOrders } from "./ActiveOrders";

export function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className={`text-xl font-black tracking-tight ${light ? "text-white" : "text-night"}`}>
      Bar<span className="text-gold">Made</span>
    </span>
  );
}

export function LangToggle({ light = false }: { light?: boolean }) {
  const { lang, setLang, t } = useApp();
  return (
    <button
      type="button"
      onClick={() => setLang(lang === "en" ? "es" : "en")}
      className={`rounded-full border px-3 py-1.5 text-sm font-bold transition ${
        light ? "border-white/40 text-white hover:bg-white/10" : "border-line bg-white text-ink hover:border-gold"
      }`}
      aria-label={t("lang.switch")}
    >
      <span aria-hidden>🌐</span> {t("lang.switch")}
    </button>
  );
}

export function Header() {
  const { customer, t, setTastesOpen } = useApp();
  return (
    <>
    <header className="sticky top-0 z-30 border-b border-line/70 bg-cream/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" aria-label="BarMade home">
          <Logo />
        </Link>
        <div className="flex items-center gap-2">
          {customer && (
            <button type="button" onClick={() => setTastesOpen(true)} className="btn-ghost px-3 py-1.5 text-sm" title={t("taste.edit")}>
              <span className="grid h-6 w-6 place-items-center rounded-full bg-gold-tint text-xs font-black text-gold-text">
                {customer.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="hidden sm:inline">{t("taste.edit")}</span>
            </button>
          )}
          <LangToggle />
        </div>
      </div>
    </header>
    <ActiveOrders />
    </>
  );
}

export function DemoFooter() {
  const { t } = useApp();
  return (
    <p className="py-8 text-center text-xs text-ink-faint">
      {t("common.demoLabel")} ·{" "}
      <Link href="/credits" className="underline hover:text-ink">
        {t("common.photoCredits")}
      </Link>
    </p>
  );
}
