# How the pickup timing works — formulas and constants

All numbers below are pinned by `MiniEatsTests/PickupPlanningTests.swift`. Change a number
→ update or add a test.

## 1. Location (`LocationService`)
- Accuracy 100 m, `distanceFilter` 50 m: re-plan only on meaningful movement.
- `CustomerStore.locationDidChange` throttles to one re-plan every 15 s.
- Background: `setBackgroundTracking(true)` only while there's an active pickup, and only
  with Always permission. Sets `allowsBackgroundLocationUpdates`, shows the blue indicator,
  turns off auto-pause. Turned off again when no pickup is open.

## 2. Route (`Routing`)
- `MKDirections` with `.automobile` (traffic-aware) or `.walking`; `source = "apple"`.
- Fallback (`source = "estimate"`): haversine km × road factor ÷ speed.

| Mode | Road factor | Speed |
|---|---|---|
| Driving | 1.3 | 19 km/h (city average incl. lights) |
| Walking | 1.2 | 4.8 km/h |

- Restaurant coordinate: `CLGeocoder` on the address in Account → Restaurant.

## 3. Ready time (`ReadyTimeModel`)
Prior, in minutes (the old server's model structure):

```
prep      = slowest item's prep prior (drinks 1 min; cooked = min(25, 8 + 1.5 × ingredients))
expected  = prep + 1.2 × items + 1.8 × open tickets + 2 (rush 11–13, 18–20) + 1 (weekend)
            grab-and-go (prep ≤ 3): prep + 0.5 × (items − 1)
p50 = expected × kitchenFactor
p75 = p50 × (1 + spread) + 1
p90 = p50 × (1 + 2 × spread) + 2
```
- Already-elapsed kitchen time is subtracted, but never below "half the remaining band" —
  a late kitchen is never reported as "ready now".
- `fit()`: from past orders' `statusHistory` (RECEIVED → READY):
  `kitchenFactor` = median(observed/expected), shrunk toward 1 with weight 5 samples;
  `spread` = 1.4826 × MAD, shrunk toward 0.25, clamped 0.15–0.6.
  Tickets over 90 min are ignored (nobody tapped Ready).

## 4. Plan (`PickupPlanner.plan`)
```
trip      = travel + overhead      (overhead: driving 2 min, walking 0.5; user-adjustable)
target    = now + p75              (or the actual READY time once the kitchen marks it)
leave_at  = target − trip
```
| Decision | When | Message |
|---|---|---|
| `too_far` | distance > 80 km | "You're N km away, too far for pickup." |
| `ready` | kitchen already marked READY | "Head over now, it's a N min drive." |
| `wait` | leave_at more than 0.5 min away | "Leave in N min so you arrive as your food comes out…" |
| `leave_now` | otherwise | "Leave now…" (+ cold-food warning if food waits > 5 min) |

## 5. After the order
- The checkout quote (`quotedReady`) is saved per order.
- Every re-plan compares the new p50 ready time to what the customer was last told; a slip of
  **≥ 5 min** posts "Running late" and moves the leave time.
- Delay-risk badge: chance of being > 10 min later than quoted, read off p50/p75/p90.
- `LeaveReminder.schedule` re-schedules the "Time to head out" notification on every re-plan
  and cancels it when the order is READY or closed.

## 6. "Ready when you arrive" (menu)
`rankForArrival`: for each dish, gap = kitchen minutes − trip minutes. A dish ready the moment
you reach the counter ranks first; waiting a little ranks above food sitting.
