"use client";

import { useEffect, useRef, useState } from "react";
import type { ViewDish, ViewSpecial } from "@/lib/types";

/**
 * Live menu snapshot the customer pages poll so manager-side changes (86 a dish,
 * reorder, chef special, Close Day) show WITHOUT a page refresh.
 *
 * The server render seeds the first value (so there is never an empty flash);
 * after mount we re-fetch /api/menu every `intervalMs` and swap dishes / special
 * / closed in place. The restaurant page folds `closed` into `acceptsOrders`,
 * but that is a server-only decision — here we expose `closed` directly so the
 * client can flip the closed banner / hide the cart live.
 */

interface MenuSnapshot {
  dishes: ViewDish[];
  special: ViewSpecial | null;
  closed: boolean;
}

interface ApiMenu {
  dishes: ViewDish[];
  special: { dishId: string; reason: ViewSpecial["reason"] } | null;
  closed?: boolean;
}

export function useLiveMenu(
  initial: { dishes: ViewDish[]; special: ViewSpecial | null; closed: boolean },
  intervalMs = 5000,
): MenuSnapshot {
  const [snap, setSnap] = useState<MenuSnapshot>(initial);
  // Keep the latest server-seeded value if the parent re-renders with new props.
  const seeded = useRef(false);
  if (!seeded.current) seeded.current = true;

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const res = await fetch("/api/menu", { cache: "no-store" });
        if (res.ok) {
          const body = (await res.json()) as { data?: ApiMenu } & ApiMenu;
          const m = (body.data ?? body) as ApiMenu;
          if (alive && Array.isArray(m.dishes)) {
            setSnap({
              dishes: m.dishes,
              special: m.special ? { dishId: m.special.dishId, reason: m.special.reason } : null,
              closed: !!m.closed,
            });
          }
        }
      } catch {
        /* transient network/backend hiccup: keep the last snapshot, try again next tick */
      } finally {
        if (alive) timer = setTimeout(tick, intervalMs);
      }
    }

    // Pause polling when the tab is hidden; resume (and refresh immediately) on return.
    function onVisibility() {
      if (document.visibilityState === "visible" && alive && !timer) tick();
    }

    timer = setTimeout(tick, intervalMs);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);

  return snap;
}
