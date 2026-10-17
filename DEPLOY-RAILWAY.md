# Railway deployment — BarMade (manager + customer, connected)

This guide deploys **three services + a database** in one Railway project so the
customer app and the manager app talk to the **same backend**.

```
Railway Project "barmade"
├── Postgres            (Railway plugin)   → provides DATABASE_URL
├── backend             (your Express API) → the shared backend both apps use
├── manager-web         (your dashboard)   → reads/writes the backend
└── customer-web        (Aleska's Next.js) → places orders through the backend
```

The **connection** is simple: both frontends are given the backend's public URL.
There is one source of truth (the backend + its Postgres).

---

## 0. One-time: push this repo to GitHub

This folder is a git repo with two branches:
- **`main`** — the application code (what we built).
- **`railway`** — same code + the deploy config (railway.json, prepare-deploy, this guide).

Create an empty GitHub repo, then from `barmade-platform/`:

```bash
git remote add origin https://github.com/<you>/barmade-platform.git
git push -u origin main
git push -u origin railway
```

Deploy from the **`railway`** branch.

---

## 1. Create the project + Postgres

1. Railway → **New Project → Deploy from GitHub repo** → pick `barmade-platform`, branch **`railway`**.
2. In the project, **New → Database → Add PostgreSQL**. Railway creates a `DATABASE_URL` variable on the Postgres service.

---

## 2. Backend service (the shared API)

1. **New → GitHub Repo** (same repo) → this becomes the `backend` service.
2. **Settings → Root Directory: `backend`**. Railway reads `backend/railway.json`:
   - build: `npm run build && npx prisma generate`
   - start: `node scripts/prepare-deploy.mjs && npm run start`
     (prepare-deploy pushes the schema and **seeds the synthetic data on first deploy only**)
   - health check: `/api/health`
3. **Variables** (Service → Variables):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Reference the Postgres plugin: `${{Postgres.DATABASE_URL}}` |
   | `OPENROUTER_API_KEY` | your OpenRouter key (for Close Day + AI reorder). Optional — falls back to deterministic. |
   | `OPENROUTER_MODEL` | `nvidia/nemotron-3-ultra-550b-a55b:free` |
   | `OPENROUTER_FALLBACK_MODELS` | `nvidia/nemotron-3-super-120b-a12b:free,nvidia/nemotron-3.5-lightning:free` |
   | `CORS_ORIGINS` | the manager + customer public URLs, comma-separated (fill after step 3/5) |

4. **Settings → Networking → Generate Domain**. Note this URL — call it **`BACKEND_URL`**
   (e.g. `https://barmade-backend-production.up.railway.app`). This is the link both apps point at.
5. Verify: open `BACKEND_URL/api/health` → `{"ok":true,"db":"postgres","orders":"barmade-api","ai":true}`.

---

## 3. Manager web service (your dashboard — PUBLIC LINK #1)

1. **New → GitHub Repo** (same repo) → `manager-web` service.
2. **Settings → Root Directory: `manager-web`**. Reads `manager-web/railway.json`:
   build `npm run build`, start `npm run preview` (binds Railway's `$PORT`).
3. **Variables:**

   | Variable | Value |
   |---|---|
   | `VITE_API_URL` | `BACKEND_URL` from step 2 (e.g. `https://barmade-backend-production.up.railway.app`) |

   > `VITE_*` vars are baked in at **build** time, so set it before/at deploy. Redeploy if you change it.
4. **Networking → Generate Domain** → this is **the manager link** you open. Call it **`MANAGER_URL`**.

---

## 4. Customer web service (Aleska's app — PUBLIC LINK #2)

Her app lives in a **different repo** (`Alonbbar6/claude_ai`, branch `aleska`, root `customer-web`).
Deploy it as a service in the **same** Railway project so it shares nothing but the backend URL.

1. **New → GitHub Repo** → `Alonbbar6/claude_ai`, branch `aleska`.
2. **Settings → Root Directory: `customer-web`** (reads `customer-web/railway.json`).
3. **Variables** (ask Aleska for the secret values — never commit them):

   | Variable | Value |
   |---|---|
   | `BARMADE_API_URL` | **`BACKEND_URL`** from step 2 — *this is the connection* |
   | `FIREBASE_SERVICE_ACCOUNT` | Aleska's Firebase service-account JSON (base64, one line) — her app stores customer profiles there |
   | `FIREBASE_PROJECT_ID` | `barmade1-7be2b` |
   | `ANTHROPIC_API_KEY` | (optional) Claude key for her "Picked for you" |

4. **Networking → Generate Domain** → **the customer link** (the QR-code URL). Call it **`CUSTOMER_URL`**.
5. Verify: `CUSTOMER_URL/api/health` → should show `"orders":"barmade-api"` (pointing at your backend).

> ⚠️ Her app ALSO reads the live menu/stock from **Firestore** (`barmade/state/*`), per her
> current contract. If you want her app to read menu/stock from **your** backend instead of
> Firestore, that's a change on HER side (point her `lib/barmade.ts` reads at your API). For the
> order-placement path, `BARMADE_API_URL` is enough — orders flow to your backend already.

---

## 5. Wire CORS (close the loop)

Back on the **backend** service, set:

```
CORS_ORIGINS = https://<MANAGER_URL>,https://<CUSTOMER_URL>
```

Redeploy the backend. Now both frontends can call it from the browser.

---

## 6. End-to-end test

1. Open `CUSTOMER_URL` on your phone → pick a dish → place an order.
2. Open `MANAGER_URL` → **Dashboard** → "Orders today" ticks up, "Dishes sold today" and inventory move live.
3. The order appears with status **RECEIVED**. Move it `PREPARING → READY → COMPLETED`
   (manager side via `PATCH /api/orders/:id/status`). The customer's tracking screen updates within ~3s.

---

## How the two apps are "connected" (the short version)

- There is **ONE backend** (yours) and **one Postgres**. It owns menu, inventory, orders, status.
- The **manager app** points at it via `VITE_API_URL`.
- The **customer app** points at it via `BARMADE_API_URL`.
- A customer order → `POST BACKEND_URL/api/orders` → deducts inventory + raises alerts → the
  manager dashboard (reading the same DB) reflects it immediately.
- Status flows back the other way: manager `PATCH`es status → customer's screen polls `GET /api/orders/:id`.

Two public links, one brain.
