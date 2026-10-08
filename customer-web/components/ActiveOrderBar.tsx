"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "./AppProvider";

interface ActiveOrder {
  id: string;
  order_number: number | null; // null = couldn't load it right now (we still link to tracking)
  status: string;
}

// Each check is a Firestore read on the team's free quota, so refresh slowly (the order page itself polls faster).
const REFRESH_MS = 60_000;

/**
 * Under the header on every page: the customer's order in progress, linking to its tracking page,
 * until it's completed or cancelled. Hidden on that order's own page.
 */
export function ActiveOrderBar() {
  const { t, activeOrderId, setActiveOrderId } = useApp();
  const pathname = usePathname();
  const [active, setActive] = useState<ActiveOrder | null>(null);

  useEffect(() => {
    if (!activeOrderId) return setActive(null);
    // Only forget the order when it's really gone or finished. A failed lookup (backend or Firestore quota
    // hiccup) keeps it, so the customer can still get back to tracking.
    const keep = () => setActive((a) => a ?? { id: activeOrderId, order_number: null, status: "RECEIVED" });
    const check = () => {
      if (document.visibilityState !== "visible") return;
      fetch(`/api/orders/${activeOrderId}`)
        .then(async (r) => {
          if (r.status === 404) return setActiveOrderId(null);
          if (!r.ok) return keep();
          const o = await r.json();
          if (o.status === "COMPLETED" || o.status === "CANCELLED") {
            setActive(null);
            setActiveOrderId(null);
          } else setActive(o);
        })
        .catch(keep);
    };
    check();
    const timer = setInterval(check, REFRESH_MS);
    return () => clearInterval(timer);
  }, [activeOrderId, setActiveOrderId]);

  if (!active || pathname === `/order/${active.id}`) return null;
  return (
    <Link href={`/order/${active.id}`} className="block bg-night text-white">
      <span className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2 text-sm">
        <span className="flex items-center gap-2 font-semibold">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-gold" />
          </span>
          {active.order_number === null
            ? t("home.activeOrderPending")
            : t("home.activeOrder", {
                n: active.order_number,
                status: t(`order.status.${active.status}` as never).toLowerCase(),
              })}
        </span>
        <span className="shrink-0 font-bold text-gold">{t("home.track")} →</span>
      </span>
    </Link>
  );
}
