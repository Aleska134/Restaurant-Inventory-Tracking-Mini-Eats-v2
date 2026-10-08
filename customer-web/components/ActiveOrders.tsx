"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "./AppProvider";

interface OrderLite {
  id: string;
  order_number: number;
  status: "RECEIVED" | "PREPARING" | "READY" | "COMPLETED" | "CANCELLED";
  fulfillment: "to_go" | "for_here";
  placed_at: string;
}

const OPEN = new Set(["RECEIVED", "PREPARING", "READY"]);

/**
 * The customer's orders that aren't finished yet, on every page. An order stays here until the
 * merchant marks it COMPLETED (picked up / served) or CANCELLED in the backend.
 */
export function ActiveOrders() {
  const { t, customer, activeOrderId } = useApp();
  const pathname = usePathname();
  const [orders, setOrders] = useState<OrderLite[]>([]);

  useEffect(() => {
    if (!customer) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const res = await fetch(`/api/orders?customerId=${customer!.id}&limit=20`, { cache: "no-store" });
        if (res.ok) {
          const data: { orders: OrderLite[] } = await res.json();
          if (!stop) setOrders(data.orders.filter((o) => OPEN.has(o.status)));
        }
      } catch {
        /* keep the last list through network blips */
      }
      if (!stop) timer = setTimeout(poll, document.hidden ? 30_000 : 8000);
    }
    poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
    // activeOrderId: refresh right after a new order is placed
  }, [customer, activeOrderId]);

  // The order page already shows its own order in full.
  const shown = orders.filter((o) => pathname !== `/order/${o.id}`);
  if (!shown.length) return null;

  return (
    <div className="border-t border-line/70 bg-night text-white">
      <div className="no-scrollbar mx-auto flex max-w-5xl gap-2 overflow-x-auto px-4 py-2">
        {shown.map((o) => (
          <Link
            key={o.id}
            href={`/order/${o.id}`}
            className="flex shrink-0 items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold hover:bg-white/20"
          >
            <span className="relative flex h-2.5 w-2.5">
              <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${o.status === "READY" ? "animate-ping bg-fresh" : "animate-ping bg-gold"}`} />
              <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${o.status === "READY" ? "bg-fresh" : "bg-gold"}`} />
            </span>
            {o.fulfillment === "to_go" ? "🥡" : "🍽️"} #{o.order_number} · {t(`order.status.${o.status}` as never)}
            <span className="text-gold">{t("home.track")} →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
