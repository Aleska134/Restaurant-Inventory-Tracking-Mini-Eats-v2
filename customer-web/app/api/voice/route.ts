import { body, errorResponse, json } from "@/lib/http";
import { cleanHistory, interpret } from "@/lib/voice";
import { isLang } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/** POST { text, lang, history? } → proposed cart actions (never places an order). */
export async function POST(req: Request) {
  try {
    const b = await body(req);
    const text = typeof b.text === "string" ? b.text.trim() : "";
    if (!text) return json({ error: "invalid", message: "text is required" }, 400);
    return json(await interpret(text, isLang(b.lang) ? b.lang : "en", cleanHistory(b.history)));
  } catch (err) {
    return errorResponse(err);
  }
}
