---
name: gps-tracking
description: Work on the BarMade iPhone app's GPS tracking and pickup timing — live location, "leave at" / "Time to head out" reminders, the on-phone ready-time model, Apple Maps routing, the tracker and Map tab, "Running late" alerts and background location. Use this whenever the user mentions GPS, location, geolocation, "when to leave", leave time, pickup timing, ETA, ready time, the tracking map, "time to head out", running late, background location, or wants to test or demo location on the Simulator or iPhone — even if they don't say "GPS". Also use it to explain how the feature works for a presentation.
---

# GPS tracking & pickup timing (BarMade customer iOS app)

The customer app tells people **when to leave** so they arrive as the food comes out.
Everything runs on the phone; the backend only supplies orders and their status history.

```
LocationService (CoreLocation, 50 m filter)
      │ moved?  (throttled to one re-plan per 15 s)
      ▼
Routing.route  ── Apple Maps directions (traffic-aware drive / walk)
      │            fallback: straight line × road factor at a fixed speed
      ▼
ReadyTimeModel.predict ── p50 / p75 / p90 minutes until ready,
      │                    tuned from this kitchen's RECEIVED→READY history
      ▼
PickupPlanner.plan ── leave_at = p75 ready − (travel + parking/walk-in)
      │                decision: wait | leave_now | ready | too_far
      ▼
LeaveReminder (local notification "Time to head out") · tracker countdown ·
"Running late" when the estimate slips ≥ 5 min past the checkout quote
```

## Where the code is (`claude_ai/ios/`)

| File | Job |
|---|---|
| `MiniEats/LocationService.swift` | CoreLocation wrapper: While-Using at launch, "Always" + background updates only while a pickup is active |
| `MiniEats/Routing.swift` | MapKit directions, haversine fallback, address geocoding (BarMade has no restaurant location) |
| `MiniEats/Prediction/ReadyTimeModel.swift` | Prior from recipe/items/kitchen load/rush hour; `fit()` learns this kitchen's pace |
| `MiniEats/Prediction/PickupPlanner.swift` | Pure function: route + ready estimate → `PickupPlan` and its message |
| `MiniEats/LeaveReminder.swift` | Schedules / cancels the leave notification; status notifications |
| `MiniEats/CustomerStore.swift` | Glue: `refreshPlan`, `replanAll`, `noteSlip`, `delayRisk`, `rankForArrival`, restaurant presets |
| `MiniEats/Views/TrackingMap.swift`, `Views/NearbyMapView.swift` | Tracker map and the Map tab |
| `MiniEatsTests/PickupPlanningTests.swift` | 15 tests for planner, model and routing fallback |
| `project.yml` | Location usage strings and `UIBackgroundModes: [location]` |

The formulas, constants and their reasons are in `references/how-it-works.md` — read it
before changing any number, because the tests pin those numbers.

## Common jobs

**Test the logic** (fast, no network):
```bash
bash .claude/skills/gps-tracking/scripts/test.sh          # PickupPlanningTests
bash .claude/skills/gps-tracking/scripts/test.sh --all    # every MiniEatsTests test
```
Add a test to `PickupPlanningTests.swift` for any rule you change; the planner and model are
pure functions, so tests don't need a device or location.

**Fake the phone's location on the Simulator** (the app must be running there):
```bash
S=.claude/skills/gps-tracking/scripts/sim-gps.sh
bash $S list                       # presets
bash $S set brickell               # jump: ~1.8 km, an 8 min drive → "Leave in N min"
bash $S set orlando                # >80 km → "too far for pickup"
bash $S drive brickell restaurant  # move along a path at city speed; watch the countdown re-plan
bash $S clear
```
Moves smaller than 50 m are ignored and re-plans are throttled to one per 15 s, so wait a
few seconds after a jump before reading the screen.

**Demo it**: place an order from the Simulator (or phone) against the **stub** or the QA
kitchen, not the live kitchen unless the user says so — see the safety note below. Then
`drive brickell restaurant` and show the countdown, the tracker map and the "Time to head out"
notification. On a real iPhone, walking/driving does the same thing; no script needed.

**Explain it** (presentation, docs): the one-liner is *"the phone learns how fast this
kitchen really is, routes your trip with live traffic, and tells you when to leave so you
arrive as your food comes out."* Use the diagram above; avoid model jargon.

## Things that bite

- **Permissions.** The app asks While-Using at launch and asks for "Always" only after the
  first order. If the tracker shows no fix, check Settings → Privacy → Location for the app,
  or on the Simulator use `sim-gps.sh set …` (a fresh Simulator has no location at all).
- **Background updates need "Always"** *and* `UIBackgroundModes: [location]` in `project.yml`
  (regenerate with `xcodegen generate` after editing it). Without Always, the leave
  notification still fires — it's scheduled locally — but the time isn't re-planned while the app is closed.
- **Restaurant position is geocoded from an address** (Account → Restaurant). A wrong or
  empty address puts the pin in the wrong place and every leave time with it.
- **Routing falls back silently** when MapKit fails (offline, no route): `routeSource` becomes
  `"estimate"`. If times look off, check that first.
- **Timestamps:** order times from the backend are UTC; the kitchen's batch dates are local
  (`JSONDecoder.barMade`). A 4–5 h error in ready time is a timezone bug, not the model.

## Safety

Placing orders to test timing writes to the team's live backend. Default to the local stub
(`node ios/scripts/barmade-stub.mjs`, then point the app's server URL at it) or ask the user
before ordering against the real kitchen. Reading orders is always fine.
