"use client";

import Link from "next/link";
import { useState } from "react";
import type { Localized } from "@/lib/content";
import type { ViewDish } from "@/lib/types";
import { useApp } from "./AppProvider";
import type { CartPreset } from "./Cart";
import { useSpeech } from "./useSpeech";

export const VOICE_ENABLED = process.env.NEXT_PUBLIC_VOICE_ORDERING === "on";

interface Turn {
  role: "user" | "assistant";
  text: string;
}

// Conversation memory for this tab: survives page changes, forgotten after 10 quiet minutes.
const HISTORY_KEY = "bm_voice_history";
const HISTORY_TTL_MS = 10 * 60_000;

function loadHistory(): Turn[] {
  try {
    const raw = JSON.parse(sessionStorage.getItem(HISTORY_KEY) ?? "null") as { at: number; turns: Turn[] } | null;
    return raw && Date.now() - raw.at < HISTORY_TTL_MS ? raw.turns : [];
  } catch {
    return [];
  }
}

function saveHistory(turns: Turn[]) {
  try {
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify({ at: Date.now(), turns: turns.slice(-8) }));
  } catch {
    /* private mode: memory lasts only for this page */
  }
}

interface VoiceResult {
  intent: "add_to_order" | "find_dish" | "unknown";
  items: { dishId: string; quantity: number }[];
  fulfillment: "to_go" | "for_here" | null;
  tableNumber: string | null;
  matches: { dishId: string; restaurantId: string; name: Localized; image: string; open: boolean }[];
  reply: string;
}

/**
 * Floating mic. Speech → /api/voice → either fills the cart and opens it for a one-tap confirm,
 * or shows matching dishes. It never places an order by itself.
 */
export function VoiceAssistant({
  dishes,
  onOpenDish,
  onReviewCart,
}: {
  dishes: ViewDish[];
  onOpenDish: (d: ViewDish) => void;
  onReviewCart: (preset: CartPreset) => void;
}) {
  const { t, L, lang, addToCart } = useApp();
  const speech = useSpeech(lang);
  const [heard, setHeard] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VoiceResult | null>(null);
  const [open, setOpen] = useState(false);

  if (!speech.supported) return null;

  async function handle(text: string) {
    setHeard(text);
    setBusy(true);
    setResult(null);
    try {
      const history = loadHistory();
      const res = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, lang, history }),
      });
      if (!res.ok) throw new Error();
      const r: VoiceResult = await res.json();
      setResult(r);
      // Remember what was said and which dishes were shown, by id, for follow-ups like "order that one".
      const shown = [
        ...r.items.map((i) => `${i.dishId} x${i.quantity}`),
        ...r.matches.map((m) => (m.open ? m.dishId : `${m.restaurantId}:${m.dishId}`) + ` (${m.name.en})`),
      ];
      saveHistory([
        ...history,
        { role: "user", text },
        { role: "assistant", text: r.reply + (shown.length ? ` [dishes shown: ${shown.join(", ")}]` : "") },
      ]);
      if (r.intent === "add_to_order" && r.items.length) {
        for (const it of r.items) {
          const d = dishes.find((x) => x.id === it.dishId);
          if (!d) continue;
          addToCart({ menuItemId: d.id, name: d.name, image: d.image, unitPrice: d.price, quantity: it.quantity, modifiers: [], modifierLabels: [] });
        }
        onReviewCart({ fulfillment: r.fulfillment, table: r.tableNumber });
      }
    } catch {
      setResult({ intent: "unknown", items: [], fulfillment: null, tableNumber: null, matches: [], reply: t("voice.error.other") });
    } finally {
      setBusy(false);
    }
  }

  function toggle() {
    if (speech.listening) return speech.stop();
    setOpen(true);
    setHeard("");
    setResult(null);
    speech.start(handle);
  }

  const errorKey = speech.error ? (`voice.error.${speech.error}` as const) : null;
  const showBubble = open && (speech.listening || busy || heard || result || errorKey);

  return (
    <div className="fixed bottom-24 right-4 z-40 flex flex-col items-end gap-2 sm:bottom-28 sm:right-6">
      {showBubble && (
        <div className="relative w-[min(22rem,calc(100vw-2rem))] rounded-2xl bg-night p-4 text-sm text-white shadow-2xl" aria-live="polite">
          <button type="button" onClick={() => setOpen(false)} aria-label={t("menu.close")} className="absolute right-2 top-2 h-7 w-7 rounded-full text-white/60 hover:bg-white/10">
            ✕
          </button>
          {speech.listening ? (
            <p className="pr-6">
              <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-gold" /> {speech.interim || t("voice.listening")}
            </p>
          ) : errorKey && !heard ? (
            <p className="pr-6 text-gold">{t(errorKey)}</p>
          ) : (
            <div className="space-y-2 pr-4">
              {heard && (
                <p className="text-white/60">
                  {t("voice.youSaid")} “{heard}”
                </p>
              )}
              {busy && <p>{t("voice.thinking")}</p>}
              {result && <p className="font-semibold">{result.reply}</p>}
              {result?.intent === "add_to_order" && result.items.length > 0 && (
                <button type="button" onClick={() => onReviewCart({ fulfillment: result.fulfillment, table: result.tableNumber })} className="btn-gold w-full py-2 text-sm">
                  {t("voice.review")} →
                </button>
              )}
              {result && result.matches.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {result.matches.map((m) => {
                    const local = m.open ? dishes.find((d) => d.id === m.dishId) : undefined;
                    const chip = (
                      <>
                        <img src={m.image} alt="" className="h-6 w-6 rounded-full object-cover" />
                        {L(m.name)}
                        {!m.open && <span className="text-white/50">🌙</span>}
                      </>
                    );
                    const cls = "inline-flex items-center gap-1.5 rounded-full bg-white/10 py-1 pl-1 pr-3 text-xs font-bold hover:bg-white/20";
                    return local ? (
                      <button key={m.restaurantId + m.dishId} type="button" className={cls} onClick={() => onOpenDish(local)}>
                        {chip}
                      </button>
                    ) : (
                      <Link key={m.restaurantId + m.dishId} href={`/r/${m.restaurantId}`} className={cls}>
                        {chip}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-label={speech.listening ? t("voice.stop") : t("voice.start")}
        aria-pressed={speech.listening}
        className={`grid h-14 w-14 place-items-center rounded-full text-2xl shadow-2xl transition hover:scale-105 active:scale-95 disabled:opacity-60 ${
          speech.listening ? "animate-pulse bg-warn text-white" : "bg-gold text-night"
        }`}
      >
        {busy ? "…" : speech.listening ? "■" : "🎤"}
      </button>
    </div>
  );
}
