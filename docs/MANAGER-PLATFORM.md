# Barmade Restaurant Platform — Manager Side

Two-sided restaurant demo platform. **This repo contains the manager side** (backend API +
manager dashboard). A teammate owns the customer-facing ordering frontend; it talks to this
backend over the documented REST contract (see `SYNC-CONTRACT.md`).

## What's here

```
barmade-platform/
├── backend/        Node + Express + TypeScript + Prisma (PostgreSQL)
│                   All inventory/sales/alert math is plain code.
│                   OpenRouter (nvidia nemotron, free) ONLY writes the end-of-day summary.
├── manager-web/    React + Vite + TS + Tailwind + Framer Motion + Recharts (manager dashboard)
├── data/           Synthetic dataset (orders, menu, inventory, movements, alerts)
└── SYNC-CONTRACT.md  REST contract the customer frontend plugs into
```

## Core design rule (from the PRD)

> **Plain code computes every number** (depletion, totals, thresholds, servings-remaining,
> overstock, anomalies). **The LLM only writes language** — the Close-Day summary. It never
> invents or changes a figure.

## Quick start (local prototype)

### 1. Database
You need a PostgreSQL `DATABASE_URL`. Easiest zero-install option: a free
[Neon](https://neon.tech) database — the same URL works for Railway later.
Put it in `backend/.env` (copy `backend/.env.example`).

### 2. Backend
```bash
cd backend
npm install
npx prisma migrate deploy        # or: npx prisma db push
npm run seed                     # loads data/*.json into Postgres (idempotent, fixed seed)
npm run dev                      # http://localhost:4000
```

### 3. Manager dashboard
```bash
cd manager-web
npm install
npm run dev                      # http://localhost:5173
```

The dashboard reads `VITE_API_URL` (defaults to `http://localhost:4000`).

## Deployment (later — Railway)
Both `backend` and `manager-web` deploy as separate Railway services; Postgres is a Railway
plugin. See `backend/railway.json` and `manager-web/railway.json`. Nothing Railway-specific is
required to run locally.
