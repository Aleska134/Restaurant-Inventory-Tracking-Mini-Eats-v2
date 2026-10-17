# BarMade sync contract — customer app ↔ this backend

This backend is the **single source of truth** (menu, inventory, orders, status).
The customer web app (`Alonbbar6/claude_ai` → `customer-web`) places orders here;
the manager dashboard reads/writes the same backend.

## Place an order — `POST /api/orders`

Accepts **both** dialects (field names interchangeable):

```jsonc
{
  "items": [
    { "menuItemId": "MENU-001", "quantity": 2 }   // customer-app dialect
    // or { "item_id": "pizza_margherita", "quantity": 2 }  // internal dialect
  ],
  "channel": "barmade",            // optional, defaults to "barmade"
  "source": "barmade-web",         // marks the order as customer-placed
  "fulfillment": "to_go",          // "to_go" | "for_here"
  "tableNumber": null,
  "customerName": "María",
  "customerId": "uuid"
}
```

`menuItemId` resolves against the MenuItem **id** OR **key**. Unavailable (86'd)
dishes and stock shortfalls are rejected.

**Success** → `201`:
```json
{ "data": { "id": "ORD-123", "status": "RECEIVED", "createdAt": "...", "items": [...], "total": 34.97, "consumed": [...] } }
```
Customer-placed orders start **RECEIVED**. Internal/simulated orders complete immediately.

**Shortage** → `409`:
```json
{ "error": { "code": "INSUFFICIENT_INVENTORY", "message": "...", "details": { "ingredientIds": [...], "menuItemIds": [...] } } }
```

## Track an order — `GET /api/orders/:id`
`{ "data": { id, status, createdAt, updatedAt, statusHistory, total, items } }`.
Customer tracking screen polls this ~every 3s.

## Move an order — `PATCH /api/orders/:id/status`
Body `{ "status": "PREPARING" }`. Lifecycle:
`RECEIVED → PREPARING → READY → COMPLETED` (CANCELLED from any non-terminal).
Invalid moves → `409 INVALID_TRANSITION`. Accepts spelling variants
(PENDING/NEW→RECEIVED, IN_PROGRESS→PREPARING, PICKED_UP/SERVED→COMPLETED, CANCELED→CANCELLED).
Each change appends `{status, at}` to `statusHistory` and sets `updatedAt`.

## Read menu / stock (read-only)
- `GET /api/menu` — items with `available`, price, `recipeLines`. `available:false` = sold out.
- `GET /api/inventory` — live stock per ingredient (packs + base units), status.

## Health
`GET /api/health` → `{ "ok": true, "db": "postgres", "orders": "barmade-api", "ai": <bool> }`.

## Connection
Customer app sets `BARMADE_API_URL` = this backend's public URL.
Manager app sets `VITE_API_URL` = the same URL. See `DEPLOY-RAILWAY.md`.
