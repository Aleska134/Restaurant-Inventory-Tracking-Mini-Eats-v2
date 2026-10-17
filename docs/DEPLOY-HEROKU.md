# Self-hosting BarMade on Heroku + Neon

This guide lets you run the whole project on **your own accounts**, so it keeps working even if the original
team's services (Ricardo's Railway backend, Alon's Firebase project, their API keys) are shut down.

You end up with:

```
                       ┌──────────────────────────── Neon (PostgreSQL) ───────────────┐
                       │                                                              │
Phone ─► customer-web (Heroku app #3) ──server-side──► backend (Heroku app #1) ◄── manager-web (Heroku app #2)
              │                                         Express + Prisma            React dashboard (browser → API)
              ├── Firebase / Firestore (your project): customers, group orders, order details
              └── AI: Gemini (or Claude) for suggestions + voice      backend ── OpenRouter: Close-Day summary
```

| Piece | Folder | Heroku app (suggested name) | Talks to |
|---|---|---|---|
| Backend API (source of truth) | `backend/` | `barmade-backend` | Neon, OpenRouter |
| Manager dashboard | `manager-web/` | `barmade-manager` | backend (from the browser) |
| Customer ordering app | `customer-web/` | `barmade-customer` | backend (server-side), Firestore, Gemini/Claude |

The Python prototype (`app/`), the old web demo (`web/`) and the iOS apps (`ios/`) are not needed for the web demo.

---

## 0. What you need (accounts and keys)

Everything below has a free tier or is covered by student credits. Create these **in your own name**:

| # | Service | What it's for | Used by | Env var(s) | Where to get it |
|---|---|---|---|---|---|
| 1 | **Heroku** | Hosting the three apps | all | — | heroku.com → GitHub Student Developer Pack offer (platform credits) |
| 2 | **Neon** | PostgreSQL for the backend | backend | `DATABASE_URL` | neon.tech → New project → Connection string |
| 3 | **Firebase** (Firestore) | Customer profiles, group orders, per-order details (to go / for here, table, name) | customer-web | `FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_PROJECT_ID` | console.firebase.google.com → new project → Firestore → Service accounts → Generate new private key |
| 4 | **Google AI Studio (Gemini)** | "Picked for you" suggestions + voice ordering | customer-web | `GEMINI_API_KEY` (+ `AI_PROVIDER=gemini`) | aistudio.google.com → Get API key |
| 5 | **Anthropic (Claude)**, *optional* | Alternative AI provider for suggestions + voice | customer-web | `ANTHROPIC_API_KEY` (+ `AI_PROVIDER=claude`) | console.anthropic.com → API keys (needs credit) |
| 6 | **OpenRouter** | End-of-day AI summary on the Close Day page (free models) | backend | `OPENROUTER_API_KEY` | openrouter.ai/keys |
| 7 | Google Maps Platform, *optional* | Only the Python prototype in `app/` (ETA, routes) | `app/` | `GOOGLE_MAPS_API_KEY` | console.cloud.google.com → Routes API |

What you **no longer need** once this is running:
- **Alon's BarMade API on Render** (`barmade-riw5.onrender.com`). It was the first backend (Express + Firestore); the
  final version uses Ricardo's backend in `backend/`.
- **Ricardo's Railway backend** (`claudeai-production-0dcc.up.railway.app`). Your Heroku backend replaces it.
- **Alon's Firebase project** (`barmade1-7be2b`). Your own Firebase project replaces it.

Never commit keys. They go into Heroku config vars (and your local `.env` files, which git ignores).

---

## 1. Install the tools (once)

```bash
brew tap heroku/brew && brew install heroku   # Heroku CLI
heroku login
node -v                                       # 20.x recommended (nvm use 20)
```

---

## 2. Database: Neon

**Recommendation: use Neon** rather than Heroku Postgres. It's free, you already know it, it isn't tied to the
host (moving from Heroku later is just a URL change), and the backend was built and tested against it.

1. neon.tech → **New project** (region close to Heroku's, e.g. US East) → database name `barmade`.
2. Copy the **direct** connection string (not the "pooled" one): Dashboard → Connection details → uncheck
   *Pooled connection*. It looks like:
   ```
   postgresql://USER:PASSWORD@ep-xxxx.us-east-2.aws.neon.tech/barmade?sslmode=require
   ```
   The direct string is safest here: the backend creates its tables with `prisma db push`, which doesn't work
   through the pooler.
3. That's all. The backend creates the tables and loads the synthetic dataset on its **first** start (step 3).

Neon's free tier suspends the database after a few idle minutes, so the first request afterwards takes about a
second longer. That's fine for a demo.

---

## 3. Backend (`backend/`) — Heroku app #1

This repo is a monorepo, so each Heroku app is told which folder to build with the **monorepo buildpack**
(`APP_BASE`), followed by the normal Node.js buildpack.

```bash
heroku create barmade-backend
heroku buildpacks:add -a barmade-backend https://github.com/lstoll/heroku-buildpack-monorepo
heroku buildpacks:add -a barmade-backend heroku/nodejs

heroku config:set -a barmade-backend \
  APP_BASE=backend \
  NPM_CONFIG_PRODUCTION=false \
  DATABASE_URL='postgresql://USER:PASSWORD@ep-xxxx.us-east-2.aws.neon.tech/barmade?sslmode=require' \
  OPENROUTER_API_KEY='sk-or-...' \
  OPENROUTER_MODEL='nvidia/nemotron-nano-9b-v2:free' \
  OPENROUTER_FALLBACK_MODELS='meta-llama/llama-3.3-70b-instruct:free,deepseek/deepseek-chat-v3-0324:free' \
  CORS_ORIGINS='https://barmade-manager-xxxx.herokuapp.com'   # fill in after step 4

git push https://git.heroku.com/barmade-backend.git main:main
```

- `NPM_CONFIG_PRODUCTION=false` keeps dev dependencies after the build. The start command needs the `prisma` CLI,
  which is a dev dependency.
- The start command is in `backend/Procfile`: `node scripts/prepare-deploy.mjs && npm start`. On every start it
  syncs the schema (`prisma db push`) and **seeds the synthetic data only if the database is empty**, so it never
  wipes data on later deploys.
- `PORT` is set by Heroku; don't set it yourself.

Check it:

```bash
curl https://barmade-backend-xxxx.herokuapp.com/api/health     # → {"ok":true,"db":"postgres",...}
curl https://barmade-backend-xxxx.herokuapp.com/api/menu | head -c 300
heroku logs --tail -a barmade-backend                           # should show "[prepare] empty DB -> seeding" once
```

---

## 4. Manager dashboard (`manager-web/`) — Heroku app #2

`VITE_API_URL` is baked in at **build** time, so set it before pushing (and redeploy if it changes).

```bash
heroku create barmade-manager
heroku buildpacks:add -a barmade-manager https://github.com/lstoll/heroku-buildpack-monorepo
heroku buildpacks:add -a barmade-manager heroku/nodejs

heroku config:set -a barmade-manager \
  APP_BASE=manager-web \
  NPM_CONFIG_PRODUCTION=false \
  VITE_API_URL='https://barmade-backend-xxxx.herokuapp.com'

git push https://git.heroku.com/barmade-manager.git main:main
```

- The start command is in `manager-web/Procfile`: `npm run preview` (Vite serves the built app on Heroku's `$PORT`).
  It needs `vite`, a dev dependency, hence `NPM_CONFIG_PRODUCTION=false`.
- Then go back and set the backend's CORS to this app's URL:
  ```bash
  heroku config:set -a barmade-backend CORS_ORIGINS='https://barmade-manager-xxxx.herokuapp.com'
  ```
  (Comma-separate several origins, e.g. if you also open the dashboard from `http://localhost:5173`.)

---

## 5. Customer app (`customer-web/`) — Heroku app #3

### 5a. Your own Firebase project (replaces Alon's)

1. console.firebase.google.com → **Add project** (Analytics not needed).
2. **Build → Firestore Database → Create database** (production mode, a region near you). No rules changes are
   needed: the app writes through the Admin SDK on the server.
3. **Project settings → Service accounts → Generate new private key**. A `.json` file downloads.
4. Turn it into one line of base64 (that's the value the app expects):
   ```bash
   base64 -i ~/Downloads/your-project-firebase-adminsdk-xxxx.json | tr -d '\n' | pbcopy   # now in your clipboard
   ```
   Then delete or move the `.json` somewhere safe. It gives full access to the database.

The app creates its collections (`customers`, `customer_app_orders`, `group_orders`) by itself. Firebase's free
(Spark) plan is enough for a demo; the app caches reads.

### 5b. Create the app

`NEXT_PUBLIC_VOICE_ORDERING` is read at **build** time, so set it before pushing.

```bash
heroku create barmade-customer
heroku buildpacks:add -a barmade-customer https://github.com/lstoll/heroku-buildpack-monorepo
heroku buildpacks:add -a barmade-customer heroku/nodejs

heroku config:set -a barmade-customer \
  APP_BASE=customer-web \
  BARMADE_API_URL='https://barmade-backend-xxxx.herokuapp.com' \
  FIREBASE_SERVICE_ACCOUNT='<paste the base64 line>' \
  FIREBASE_PROJECT_ID='your-firebase-project-id' \
  AI_PROVIDER=gemini \
  GEMINI_API_KEY='...' \
  NEXT_PUBLIC_VOICE_ORDERING=on

git push https://git.heroku.com/barmade-customer.git main:main
```

- The start command is in `customer-web/Procfile`: `npm start` (Next.js on Heroku's `$PORT`).
- The customer app calls the backend **from its server**, so it doesn't need to be in the backend's CORS list.
- Optional: `ANTHROPIC_API_KEY` (and `AI_PROVIDER=claude`) to use Claude instead of Gemini;
  `GEMINI_MODEL` / `GEMINI_FALLBACK_MODEL` to change models (defaults `gemini-3.5-flash` → `gemini-3.5-flash-lite`).
- More detail on every variable: `customer-web/HANDOFF.md`.

Check it:

```bash
curl https://barmade-customer-xxxx.herokuapp.com/api/health
# → {"ok":true,"db":"firestore","orders":"barmade-api","ai":"gemini"}
cd customer-web && npm run smoke -- https://barmade-customer-xxxx.herokuapp.com    # read-only
```

---

## 6. End-to-end test

1. Open the **manager** URL: the dashboard shows the Trattoria's inventory and sales. Open the day if it's closed.
2. Open the **customer** URL on your phone (HTTPS is required for the mic): enter a name, add a Coca-Cola, choose
   *To go*, place the order.
3. The order appears on the manager's **Orders** board. Move it to *Preparing* → *Ready* → *Completed*; the
   customer's tracking page and open-orders bar follow within a few seconds.
4. Try voice ("where can I get sushi?") and a group order with a second browser (incognito window).
5. Make a QR code of the customer URL for presentations.

---

## 7. Costs and sleeping dynos

- **Eco dynos** are the cheapest Heroku option: one Eco plan covers a pool of dyno hours shared by all your Eco
  apps, so all three apps fit in it. They **sleep after ~30 minutes without traffic**, and the first request
  afterwards takes ~10–20 s. Before a demo, open all three URLs a couple of minutes early.
- Basic dynos never sleep but are billed per app. Check Heroku's current prices and your student credit balance
  in the Heroku dashboard (Billing) before choosing.
- Neon free tier, Firebase Spark, Gemini's free tier and OpenRouter's free models cost nothing at demo scale.

---

## 8. Updating

The same `git push` to each Heroku remote redeploys. Handy shortcuts:

```bash
git remote add heroku-backend  https://git.heroku.com/barmade-backend.git
git remote add heroku-manager  https://git.heroku.com/barmade-manager.git
git remote add heroku-customer https://git.heroku.com/barmade-customer.git
git push heroku-backend main && git push heroku-manager main && git push heroku-customer main
```

Or connect each Heroku app to the GitHub repo (Deploy tab → GitHub → `Aleska134/Restaurant-Inventory-Tracking-Mini-Eats-v2`,
branch `main`, *Enable automatic deploys*). Each app still builds only its own folder thanks to `APP_BASE`.

---

## 9. Other things that point at the old services

If you keep using them, update these too:

| Where | Points at | Change to |
|---|---|---|
| `ios/project.yml`, `ios/MiniEats.xcodeproj` (`BARMADE_API_URL`) | Ricardo's Railway backend | your Heroku backend URL |
| `.claude/skills/connectivity/scripts/check.sh` (`BARMADE`) | Ricardo's Railway backend | your Heroku backend URL |
| `web/` (old Python demo, `BARMADE_URL`) | Alon's Render API | your Heroku backend URL (optional) |

---

## Troubleshooting

| Symptom | Likely cause → fix |
|---|---|
| Backend crashes on start with `prisma: not found` | `NPM_CONFIG_PRODUCTION=false` missing on the backend app → set it and redeploy |
| Manager page is blank / `vite: not found` in logs | Same, on the manager app |
| Manager shows network / CORS errors | Backend `CORS_ORIGINS` doesn't include the manager URL exactly (scheme + host, no trailing slash) |
| Customer `/api/health` says `"db":"embedded"` | `FIREBASE_SERVICE_ACCOUNT` missing or not valid base64 |
| Customer menu shows everything sold out | `BARMADE_API_URL` wrong, or the backend is asleep or failing → check `/api/menu` on the backend |
| Mic says "the voice assistant isn't available" | No AI key, out of credit, or `AI_PROVIDER` points at a provider without a key |
| Mic button missing | `NEXT_PUBLIC_VOICE_ORDERING=on` was set after the build → redeploy |
| `prisma db push` fails on Neon | You used the pooled connection string → use the direct one |
