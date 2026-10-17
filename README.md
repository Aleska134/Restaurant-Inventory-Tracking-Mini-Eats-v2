# BarMade — Restaurant Ordering & Inventory Platform

A two-sided restaurant platform built for **BarMade**. Small restaurants get **live, recipe-based inventory**
(every sale deducts ingredients, low-stock and expiry alerts, purchase orders, end-of-day summaries), and their
customers **skip the lunch line by ordering ahead from their phone**, with to go / for here, live order
tracking, AI suggestions, **voice ordering** and **group orders with a split bill**.

All restaurant data is **synthetic**: a fictional Italian restaurant, *Trattoria Little Italy*, with two months
of history. The app is in English, with a full Spanish toggle on the customer side.

```
                     ┌──────────────────────────── PostgreSQL (Neon) ───────────────────────┐
                     │                                                                      │
 Customer's phone ─► customer-web ──server-side REST──► backend ◄──────────────────── manager-web
 (QR code)           Next.js 16                         Express + Prisma               React + Vite dashboard
                     │  ├─ Firestore: profiles, group orders, order details             (restaurant owner)
                     │  └─ Gemini or Claude: suggestions + voice                 OpenRouter: Close-Day summary
```

| Part | Folder | What it is |
|---|---|---|
| **Customer web app** | [`customer-web/`](customer-web/HANDOFF.md) | Ordering site customers open from a QR code. Next.js 16 + React 19 + Tailwind. |
| **Backend API** | [`backend/`](docs/MANAGER-PLATFORM.md) | Single source of truth: menu, recipes, inventory, orders, alerts, vendors, sales. Express + TypeScript + Prisma + PostgreSQL. |
| **Manager dashboard** | [`manager-web/`](docs/MANAGER-PLATFORM.md) | The restaurant owner's console. React + Vite + Tailwind + Recharts. |
| Earlier prototypes | `app/`, `web/`, `ios/` | Python ETA/dispatch prototype, first web demo, SwiftUI apps (see [below](#earlier-prototypes)). |

---

## Features

### For customers (`customer-web/`)

- **Account with just a name**, remembered on the device. English by default, with a Spanish toggle that also
  translates dish names and descriptions.
- **Live menu** from the backend: price, stock, "Only N left" and "Sold out". When the manager 86's a dish or
  closes the day, the customer side follows within seconds.
- **Allergen badges** derived from recipe ingredients, plus a saved "avoid" list that flags and sorts away
  clashing dishes.
- **Chef's special** picked from what the kitchen has the most of compared with its reorder point.
- **"Picked for you" suggestions** from taste chips or a free-text craving, written by the AI (Gemini or Claude).
- **Voice ordering** from the home page or the menu, in English or Spanish:
  - "two Margheritas and a Coke, to go" fills the cart, shows what was added with **Undo**, and the customer
    confirms. Voice never orders by itself.
  - "where can I get sushi?" searches every restaurant, including closed ones, and suggests an open alternative.
  - "dinner for two under $40, no pork" builds a meal; code enforces budget, stock and allergens.
  - Follow-ups like "order that one" remember the conversation.
- **Group orders:** share a 4-letter code, everyone adds their own dishes live, the host picks *each pays their
  own* or *split equally* (exact cents) and sends **one** order to the kitchen.
- **🥡 To go or 🍽️ For here** (with table number). Payment happens at the counter or table.
- **Live tracking** (`RECEIVED → PREPARING → READY → COMPLETED`) and an **open orders bar** on every page that
  keeps each order visible until the kitchen completes it.
- **Three browse-only "closed" restaurants** (Cuban, sushi, healthy bowls) with original illustrations, to make
  the marketplace feel real.

### For the restaurant (`manager-web/` + `backend/`)

- **Dashboard:** today's orders, revenue, alerts, low/out-of-stock, dishes sold, a projection of expected vs.
  actual sales, and menu readiness (what can still be served). A date picker shows past days.
- **Inventory:** live stock per ingredient (batch-tracked), servings remaining per dish, overstock, physical
  counts with confirmation, and the movement history behind every number.
- **Orders board:** customer orders arrive live and move through *Preparing → Ready → Completed*.
- **Alerts:** low stock and expiring batches, with one-tap actions: reorder, 86 the dish, substitute an
  ingredient, or serve without it.
- **Cart and vendors:** a purchasing cart (add low-stock items, weekly suggestions), vendor comparison, product
  pricing, and AI-drafted purchase-order emails.
- **Sales:** by day, by dish and by channel (BarMade vs. Uber Eats / DoorDash fees).
- **Close / Open day:** a readiness check, then an end-of-day summary written by an LLM from computed facts.
- **Simulate rush** for live demos.

### Design rule (from the PRD)

> **Plain code computes every number** (stock, totals, thresholds, servings, budgets, prices).
> **The AI only picks options and writes language.** It never sees customers' names or ids, and it never
> invents or changes a figure.

---

## Run it locally

You need **Node 20** (`nvm use 20`) and a PostgreSQL URL (a free [Neon](https://neon.tech) database is easiest).

```bash
# 1) Backend: http://localhost:4000
cd backend
cp .env.example .env          # set DATABASE_URL (+ OPENROUTER_API_KEY for the Close-Day summary)
npm install
npx prisma db push            # create the tables
npm run seed                  # load the synthetic dataset (idempotent)
npm run dev

# 2) Manager dashboard: http://localhost:5173
cd manager-web
npm install
VITE_API_URL=http://localhost:4000 npm run dev

# 3) Customer app: http://localhost:3000
cd customer-web
cp .env.example .env          # BARMADE_API_URL=http://localhost:4000, Firebase, AI_PROVIDER + GEMINI_API_KEY,
npm install                   # NEXT_PUBLIC_VOICE_ORDERING=on
npm run dev
```

Without `BARMADE_API_URL` and Firebase variables, the customer app also runs **fully offline** on the synthetic
dataset, which is handy for UI work.

## Deploy

- **Heroku + Neon on your own accounts:** [`docs/DEPLOY-HEROKU.md`](docs/DEPLOY-HEROKU.md). Step by step for all
  three apps, plus every external API key the project needs, so it doesn't depend on anyone else's services.
- **Railway:** [`DEPLOY-RAILWAY.md`](DEPLOY-RAILWAY.md) (how the team demo was deployed).
- Customer app details (every variable, voice, group orders, demo-day checklist):
  [`customer-web/HANDOFF.md`](customer-web/HANDOFF.md).

## How the apps talk to each other

The customer app calls the backend **from its server** (never from the browser):

| Call | Purpose |
|---|---|
| `GET /api/menu`, `GET /api/inventory` | Live menu and stock (sold out, "only N left") |
| `GET /api/status` | Restaurant open / closed (closed day = no orders) |
| `POST /api/orders/precheck` | Dry-run stock check before confirming |
| `POST /api/orders` | Place an order (`channel: "barmade"`, `source: "barmade-web"`, to go / for here, table, name) |
| `GET /api/orders/:id` | Order status for live tracking |
| `PATCH /api/orders/:id/status` | Used by the manager dashboard to move the order forward |

The full contract is in [`SYNC-CONTRACT.md`](SYNC-CONTRACT.md); the first version is in
[`docs/handoff/orders-contract.md`](docs/handoff/orders-contract.md).

## Repository layout

```
customer-web/      customer ordering app (Next.js)          → customer-web/HANDOFF.md
backend/           API + database (Express, Prisma, Postgres) → docs/MANAGER-PLATFORM.md
manager-web/       restaurant dashboard (React, Vite)
data/              synthetic dataset for the backend seed
docs/              DEPLOY-HEROKU.md · MANAGER-PLATFORM.md · MINI-EATS-PROTOTYPE.md · handoff/
SYNC-CONTRACT.md   customer app ↔ backend contract
DEPLOY-RAILWAY.md  Railway deployment of the team demo
app/ static/ tests/ scripts/ datasets/   Mini Eats Python prototype (ETA, dispatch, notifications)
web/               first manager web demo (Python, read-only on the first BarMade API)
ios/               SwiftUI customer + merchant apps
```

## Earlier prototypes

- **Mini Eats (Python / FastAPI):** a delivery prototype with a predictive ETA model using Google Maps travel times,
  a pickup "when to leave" planner, courier dispatch and an event-driven notification system.
  See [`docs/MINI-EATS-PROTOTYPE.md`](docs/MINI-EATS-PROTOTYPE.md).
- **iOS apps (SwiftUI):** a customer app and a merchant app with GPS-based pickup timing, wired to the BarMade
  backend. See [`ios/README.md`](ios/README.md).
- **`web/`:** the first manager web demo (Python), built against the first BarMade API on Render.

---

## Team

Built as a team project at Miami Dade College for BarMade:

- **Aleska Braschi**: customer web app (ordering, EN/ES, voice ordering, group orders, AI suggestions), integration
  and ongoing maintenance of this repository.
- **Ricardo Molina**: manager platform (backend API, PostgreSQL, manager dashboard) and the customer ↔ backend sync.
- **Alonso Bardales**: first BarMade API, the Mini Eats prototype, the iOS apps and the first web demo.
- …and the rest of the team, who shaped the PRD, the synthetic dataset and the demo.

This repository continues the team repo [`Alonbbar6/claude_ai`](https://github.com/Alonbbar6/claude_ai), with its
full history.
