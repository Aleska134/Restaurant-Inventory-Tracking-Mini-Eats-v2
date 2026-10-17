# Mini Eats prototype (Python backend)

> The first prototype of this project. It is not used by the BarMade web demo; see the main [README](../README.md).

A small Uber Eats-style food delivery app built to exercise two things:

1. **Predictive ETA model** – gradient-boosted models that quote delivery time and a
   "delay risk" probability, using **Google Maps distance and traffic-aware travel
   time** as features.
2. **Notification system** – an event-driven pipeline (status changes, ETA slips,
   courier dispatch) with per-user channels, quiet hours, dedup, retry and a
   delivery log, streamed live to the browser over WebSocket.

On top of those, orders are **dispatched by distance**: when the kitchen confirms,
the app routes every free courier to the restaurant and times their departure so
they arrive as the food comes out.

## iOS app

A SwiftUI client lives in [`ios/`](../ios/README.md): browse, cart, checkout, live order tracking and push-style notifications against this backend.

## Run it

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt pytest-asyncio
cp .env.example .env            # optional: add your Google Maps key
export $(grep -v '^#' .env | xargs)
.venv/bin/uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000. Pick a user and a restaurant, add items, and watch the
order move through the lifecycle (one stage every 4 s) with notifications arriving in
real time. "Simulate demand spike" re-runs the model and fires a *Running late* alert
when the ETA slips 5+ minutes.

Without `GOOGLE_MAPS_API_KEY` the app uses a straight-line fallback (haversine × 1.3
road factor at 19 km/h) and labels it as such in the UI.

Tests: `.venv/bin/pytest`

## How it works

```
POST /api/orders
  └─ maps.route(restaurant → customer)      Google Routes API (TRAFFIC_AWARE)
  └─ predictor.predict(...)                 ETA + delay risk, quoted to the customer
  └─ bus.publish(order.status_changed)      → NotificationService → push/sms/email/ws

advance → confirmed
  └─ plan_dispatch()
       ready_at   = now + kitchen time (prep + items + backlog)
       for each free courier: maps.route(courier → restaurant)
       choose courier that lands closest to ready_at (never late if avoidable)
       dispatch_at = ready_at − courier travel time
       delivery_at = pickup + customer-leg travel time

advance → preparing / courier_dispatched / picked_up / delivered
  └─ refresh_eta()  re-predict with live courier load & backlog
       slip ≥ 5 min → bus.publish(order.delayed) → "Running late" notification
```

### Prediction (`app/prediction/`)

| file | role |
|---|---|
| `features.py` | single source of truth for the feature vector (distance, Google travel time, prep time, items, hour, weekend, rain, courier load, restaurant backlog, rush hour) |
| `synthetic.py` | generates training history from a plausible generative process — swap for a real table of delivered orders |
| `eta.py` | `EtaPredictor`: `GradientBoostingRegressor` (minutes) + `GradientBoostingClassifier` (P(late > 10 min)); trains on first start and caches to `models/eta.pkl`; re-scales to "minutes remaining" per lifecycle stage |

`GET /api/predict/model` reports held-out MAE / AUC and feature importances.

### Pickup timing (`app/prediction/ready.py`, `app/pickup.py`)

For pickup orders the app tells you **when to leave** so you get there as the food
comes out: no waiting at the counter, no cold food.

- **Kitchen ready-time model**: three quantile gradient-boosting models give a range
  for when the food is ready: p50 (most likely), p75 (planned against), p90 (almost
  surely ready). Inputs: restaurant prep time, items, kitchen backlog, hour/rush/weekend.
  Calibrated on held-out data (p75 covers ~74% of orders, p90 ~90%). Delivery dispatch
  uses the same model's p50 to time couriers.
- **Planner** (pure function): `leave_at = p75 ready time − (travel time + parking/walk-in)`,
  with travel from the customer's live GPS location by car or on foot (Google Routes API
  `mode=driving|walking`). It returns `wait` (leave in N min), `leave_now`, `ready`, or
  `too_far`, plus how long the food would sit (`food_wait_min`) or you would wait.
- **Live re-planning**: the app sends location as you move (`POST /api/orders/{id}/pickup-plan`),
  and the server re-plans every 30 s while the kitchen cooks. When it's time, it sends a
  **"Time to head out"** notification once (deduplicated), even if the app is closed.

### Routing (`app/maps.py`)

`GoogleMapsProvider` calls the Routes API `computeRouteMatrix` (traffic-aware for driving), caches
results for 60 s, and falls back to `HaversineProvider` on any error so an outage or
bad key never blocks orders. Both return a `RouteEstimate(distance_km, duration_min,
source)`.

### Notifications (`app/notifications/`)

| file | role |
|---|---|
| `events.py` | tiny async event bus (`order.status_changed`, `order.eta_updated`, `order.delayed`) |
| `templates.py` | message per notification kind; `urgent` ones bypass quiet hours |
| `channels.py` | `SimulatedChannel` for push/SMS/email (logs, random failures to exercise retry) and a real `WebSocketChannel` |
| `service.py` | preference-aware dispatch with dedup, quiet-hours deferral + `flush_deferred()`, 3× retry with backoff, delivery log |

## API

| method | path | purpose |
|---|---|---|
| GET | `/api/restaurants`, `/api/users`, `/api/couriers` | seed data |
| PUT | `/api/users/{id}/preferences` | channels & quiet hours |
| POST | `/api/predict/eta` | quote before ordering (includes the Google route) |
| POST | `/api/predict/pickup` | pickup quote: ready time range, trip, when to leave |
| GET | `/api/predict/model` | model metrics & feature importance |
| POST | `/api/orders` | place an order (routes, quotes, notifies, starts simulation) |
| GET | `/api/orders?user_id=` · `/api/orders/{id}` | list / detail |
| GET | `/api/orders/{id}/dispatch` | courier dispatch plan (after confirmation) |
| POST | `/api/orders/{id}/advance` · `/cancel` · `/refresh-eta?demand_shock=` | drive the lifecycle manually |
| POST | `/api/orders/{id}/pickup-plan` | re-plan pickup from `{lat, lng, mode}` |
| POST | `/api/orders/{id}/collect` | pickup: customer has the food |
| GET | `/api/notifications?user_id=` | notifications with per-channel delivery records |
| POST | `/api/notifications/flush-deferred` | send what quiet hours held back |
| WS | `/ws/{user_id}` | live notification stream |

## Next steps

- Replace `synthetic.py` with real delivered-order history (store each order's
  Google quote alongside the actual delivery time) and retrain on a schedule.
- Geocode free-text addresses (Google Geocoding API) instead of fixed lat/lng.
- Real providers for push (FCM/APNs), SMS (Twilio) and email behind the same
  `BaseChannel` interface.
- Persist orders/notifications (Postgres) and move the event bus to a queue.
