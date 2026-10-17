# BarMade customer web: deployment hand-off (Railway)

The customer-facing ordering app (the page people open from the QR code). It is a Next.js 16 app in
`customer-web/` and runs as **one Railway service** that serves the pages and a small server API (`/api/*`).
To host everything on your own accounts with Heroku + Neon instead, follow [`docs/DEPLOY-HEROKU.md`](../docs/DEPLOY-HEROKU.md).

```
Phone ─► customer-web ──POST /api/orders──► BarMade backend (backend/, Express + Prisma) ─► PostgreSQL
                 │                                                               ▲
                 ├────────── reads menu, stock, order status (read-only) ─────────┘
                 └────────── AI: Claude or Gemini (suggestions + voice; no customer personal data)
```

Menu, inventory, orders, movements and order status belong to the **BarMade backend** in [`backend/`](../backend)
(team demo: `https://claudeai-production-0dcc.up.railway.app`; self-hosting: [`docs/DEPLOY-HEROKU.md`](../docs/DEPLOY-HEROKU.md)).
The customer app reads and writes those only through the backend's REST API ([`SYNC-CONTRACT.md`](../SYNC-CONTRACT.md)).
In Firestore it only keeps its own collections:
`customers` (name-only profiles), `customer_app_orders` (to go / for here, table, name per order) and
`group_orders` (group sessions).

## Deploy on Railway

1. **New Project → Deploy from GitHub repo**, then pick this repo and the branch.
2. Service **Settings → Root Directory: `customer-web`**. Railway then reads `customer-web/railway.json`:
   - build: `npm run build`
   - start: `npm start` (listens on Railway's `$PORT`)
   - health check: `/api/health`
3. **Node 20+** (taken from `engines` in `package.json` and from `.nvmrc`). Next 16 does not build on Node 18;
   locally, run `nvm use` in `customer-web/` in every new terminal (or `nvm alias default 20` once).
4. **Variables** (Service → Variables). Ask Aleska for the values, and **never commit them or paste them in chat**:

| Variable | Required | Value |
|---|---|---|
| `BARMADE_API_URL` | **Yes** | The backend's URL, e.g. `https://claudeai-production-0dcc.up.railway.app` or your Heroku backend. |
| `FIREBASE_SERVICE_ACCOUNT` | **Yes** | The Firebase service-account JSON **in base64, on one line** (the same value as in Aleska's `customer-web/.env`). Stores customer profiles, group orders and per-order details (to go / for here, table, name). Use your own Firebase project when self-hosting. |
| `FIREBASE_PROJECT_ID` | Yes | `barmade1-7be2b` |
| `NEXT_PUBLIC_VOICE_ORDERING` | For voice | `on` shows the 🎤 voice button on the home page and the Trattoria menu (Chrome / Safari). Read at **build** time, so redeploy after changing it. Off by default. |
| `AI_PROVIDER` | No | `claude` (default) or `gemini`. Picks the AI for "Picked for you" suggestions and voice. If only one key is set, that provider is used automatically. |
| `GEMINI_API_KEY` | One AI key for voice | Google Gemini key. |
| `GEMINI_MODEL` / `GEMINI_FALLBACK_MODEL` | No | Default `gemini-3.5-flash` (~2.4 s). If Google answers "busy" (503) or times out, the call is retried once with `gemini-3.5-flash-lite` (~1 s). |
| `ANTHROPIC_API_KEY` | One AI key for voice | Claude key. |
| `ANTHROPIC_MODEL` / `VOICE_MODEL` | No | Claude model (default `claude-opus-5-5`). `VOICE_MODEL` overrides it for voice only. |

   Without any AI key the app still works: suggestions fall back to rules, and the mic says the voice assistant
   isn't available. Ordering, tracking and group orders never depend on the AI.

5. **Settings → Networking → Generate Domain**. That URL is the one for the QR code.
6. **Check it:** open `https://<domain>/api/health`. It should return:
   ```json
   {"ok":true,"db":"firestore","orders":"barmade-api","ai":"gemini"}
   ```
   (`"ai"` is `"claude"`, `"gemini"` or `false`.) If it says `"db":"embedded"` or `"orders":"local"`, a variable is
   missing: the app would then keep data on Railway's disk, which is wiped on every deploy.
7. Optional end-to-end check from your machine: `cd customer-web && npm install && npm run smoke -- https://<domain>`.
   It is **read-only** against the real backend (health, menu, suggestions). Add `--write` to place ONE real
   test order (a Coca-Cola). That deducts real inventory, so only do it on purpose.

## Voice ordering

Turn it on with `NEXT_PUBLIC_VOICE_ORDERING=on` plus a Claude or Gemini key, then **redeploy** (the flag is baked in
at build time). The mic needs HTTPS (Railway provides it) and the browser's microphone permission.

- **Where:** a 🎤 button on the **home page** (with an "Ask me where to eat" hint) and on the **Trattoria menu**.
- **Ordering:** "two Margheritas and a Coke, to go" (English or Spanish). The AI turns it into cart items, the server
  checks them against the live menu and stock, and the mic bubble lists **exactly what was added**, with **Undo** and
  **Review order**. Review order opens the cart with to go / for here and the table pre-set; from the home page it
  goes to the Trattoria menu with the cart already open. If a word is unclear or not on the menu, nothing is added:
  the likely dishes appear as choices to tap. **Voice never places an order by itself.**
- **Where to eat:** "where can I get sushi?" shows matching dishes from every restaurant, including closed ones
  ("opens at 5 PM"), plus an open alternative. Tapping a result opens that restaurant or dish.
- **Building a meal:** "dinner for two under $40, no pork". The AI picks dishes; code removes anything sold out or
  containing what the customer avoids (their saved list plus what they said), trims to the budget and computes the
  total (PRD: the AI never calculates). The saved avoid list (Tastes → "Anything to avoid?") also reshapes the menu:
  clashing dishes get a ⚠ chip, sort last and can be hidden.
- **Memory:** follow-ups like "order that one" / "pídemelo" refer to what was just suggested. The conversation is
  kept for the browser tab (it survives closing the bubble and changing pages) and is forgotten after 10 quiet minutes.

## Open orders bar

A dark bar under the header, on every page, lists the customer's orders that are **RECEIVED, PREPARING or READY**
(with a green dot when ready) and links to tracking. It refreshes every 8 s (30 s in a background tab). An order
leaves the bar only when the merchant marks it **COMPLETED** or **CANCELLED** in the backend. Group orders show up
for every member, not just the host.

## Group orders

On the Trattoria menu, **"Order as a group"** creates a 4-letter code and link (`/g/CODE`); others can also type the
code on the menu. Friends open it, enter their name and add their own dishes, and everyone sees each other's dishes
live. The host picks **"each pays their own"** or **"split equally"** (exact cents), to go / for here and table, then
sends **one** order to the kitchen through the normal path (stock check, BarMade API, inventory deducted). Each person
then sees what they pay (at the counter or table; no online payment), and the host can mark people as paid.
A double tap can't send two orders, and dishes lock once the order is sent. Groups hold up to 12 people, live in
Firestore `group_orders/{code}`, and expire after 6 hours.

## Before the demo

- **AI credit:** the Claude API account ran out of credit during testing, so the app was switched to Gemini
  (`AI_PROVIDER=gemini`). Either works. Check that `/api/health` shows the right `"ai"` and that the mic answers a question.
- **Firestore:** the team moved the Firebase project off the free tier, which had hit its ~50k reads/day limit once.
  The customer app also caches live reads for 15 s, serves the last good copy on errors, and pauses backend calls
  for 60 s after a failure.
- **Wake the backend up ~2 minutes before presenting**: open `<BARMADE_API_URL>/api/menu`. Sleeping hosts
  (Heroku Eco dynos, Render free tier) take 10–50 s to answer the first request after a nap. The customer app also pings it every few minutes while
  someone is browsing.
- Open the Railway URL on a real phone: enter a name, add a dish, then check that the order shows up on the merchant side.
- The merchant moves orders with `PATCH /api/orders/:id/status` (`RECEIVED → PREPARING → READY → COMPLETED`, or
  `CANCELLED`). The customer's order page and the open orders bar update by themselves within a few seconds.

## Run locally

```bash
cd customer-web
nvm use               # Node 20
npm install
cp .env.example .env  # then fill in the variables above
npm run dev           # http://localhost:3000
```

With no `BARMADE_API_URL` and no Firebase variables, the app runs fully offline: it uses the synthetic dataset, an
embedded database in `customer-web/.pglite/` (delete that folder to reset) and keeps group orders in memory. That's
handy for UI work, and it never touches the team's data.

## Folder map

```
customer-web/
├── app/                    pages + API routes
│   ├── page.tsx            home: open restaurant, chef's special, closed "More on BarMade", voice
│   ├── r/[id]/page.tsx     restaurant menu (Trattoria orders; the others are browse-only)
│   ├── order/[id]/page.tsx live order tracking
│   ├── g/[code]/page.tsx   group order (shared dishes, split bill, send)
│   ├── credits/            photo/illustration credits
│   └── api/
│       ├── customers/      POST create (name only) · GET/PATCH /:id (language, tastes)
│       ├── menu/           GET live menu with stock-based availability + chef's special
│       ├── orders/         POST place order (→ BarMade API) · GET ?customerId= · GET /:id (status)
│       ├── groups/         POST create · GET/PATCH /:code · POST /:code/join · PUT /:code/items · POST /:code/place
│       ├── recommend/      POST taste-based suggestions (AI, falls back to rules)
│       ├── voice/          POST speech text (+ history) → validated cart actions / matches
│       └── health/         GET which storage / backend / AI is active
├── components/             UI (React, Tailwind): VoiceAssistant, ActiveOrders, GroupOrder, MenuView, Cart…
├── lib/
│   ├── ai.ts               one structured-output call for Claude or Gemini (+ Gemini busy fallback)
│   ├── voice.ts            voice intents: add to order, find a dish, build a meal (validated by code)
│   ├── recommend.ts        "Picked for you" suggestions (no customer personal data sent)
│   ├── groups.ts           group sessions, split bill, one kitchen order
│   ├── barmade.ts          BarMade API client: live menu/inventory, open/closed status, order precheck
│   ├── barmade-orders.ts   orders through the BarMade API, status mapping
│   ├── catalog.ts          menu, recipes, allergens, stock, chef's special
│   ├── orders.ts           validation, then BarMade API (or local store when offline)
│   ├── customers.ts        name-only accounts + taste profile
│   ├── store/              where customers live: firestore.ts · postgres.ts (offline)
│   ├── content.ts          EN/ES copy, images, browse-only restaurants
│   └── i18n.ts             English (default) / Spanish
├── data/barmade/           synthetic dataset (used offline, and for the 12 dishes shown as sold out)
├── public/images/          Trattoria photos (Wikimedia, see credits.json) + original SVG illustrations
├── scripts/smoke.mjs       end-to-end check
└── railway.json            Railway build/start/health-check
```

## Demo guardrails (from the PRD)

- Stock shown to customers is an **estimate** from recipes and live batches. Sold-out dishes can't be ordered.
- The AI (Claude or Gemini) only gets the menu, anonymous tastes and what was said to the mic, never the customer's
  name or id. Code decides what is safe, in stock and within budget; the AI only picks dishes and writes the replies.
- Allergen badges are derived from recipe ingredients and come with an "ask staff" note.
- The footer says "Classroom demo · synthetic data". There are no payments: "Pay at pickup / at your table", and
  group orders only show who pays what.

See also `docs/handoff/orders-contract.md` for the contract with the backend.
