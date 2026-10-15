#!/usr/bin/env bash
# Fake the iPhone Simulator's GPS for testing BarMade pickup timing.
#   sim-gps.sh list
#   sim-gps.sh set <preset|lat,lon>            jump there
#   sim-gps.sh drive <from> <to> [m/s]          move along a straight path (default 12 m/s ≈ 43 km/h)
#   sim-gps.sh walk  <from> <to>                same at 1.4 m/s
#   sim-gps.sh clear
# Acts on every booted Simulator, or only on SIM_UDID if set.
set -euo pipefail

preset() {
  case "$1" in
    restaurant) echo "25.7742,-80.1924" ;;  # Trattoria Little Italy, 120 E Flagler St (app default)
    mdc)        echo "25.7776,-80.1898" ;;  # MDC Wolfson, 300 NE 2nd Ave (QA Test Kitchen preset)
    brickell)   echo "25.7618,-80.1912" ;;  # ~1.8 km by road, 8 min drive → "Leave in N min"
    wynwood)    echo "25.8007,-80.1993" ;;  # ~3 km north
    gables)     echo "25.7215,-80.2793" ;;  # ~10 km: "leave now" on most orders
    orlando)    echo "28.5383,-81.3792" ;;  # >80 km: "too far for pickup"
    *,*)        echo "$1" ;;
    *) echo "unknown place '$1' (try: sim-gps.sh list)" >&2; exit 2 ;;
  esac
}

devices() {
  if [ -n "${SIM_UDID:-}" ]; then echo "$SIM_UDID"; return; fi
  xcrun simctl list devices booted | grep -Eo '\([0-9A-F-]{36}\)' | tr -d '()'
}

run_all() {
  local ds; ds=$(devices)
  [ -n "$ds" ] || { echo "No booted Simulator. Boot one and launch the app first." >&2; exit 1; }
  for d in $ds; do xcrun simctl location "$d" "$@"; done
}

cmd=${1:-list}
case "$cmd" in
  list)
    printf '%-11s %s\n' restaurant "Trattoria Little Italy (pin) — expect 'Head over now' / 0 min trip" \
      mdc "MDC Wolfson (QA kitchen preset)" brickell "~1.8 km, 8 min drive — 'Leave in N min'" \
      wynwood "~3 km" gables "~10 km — usually 'Leave now'" orlando ">80 km — 'too far for pickup'" ;;
  set)   [ $# -ge 2 ] || { echo "usage: sim-gps.sh set <place>" >&2; exit 2; }
         run_all set "$(preset "$2")"; echo "GPS set to $2 ($(preset "$2"))" ;;
  drive|walk)
         [ $# -ge 3 ] || { echo "usage: sim-gps.sh $cmd <from> <to> [m/s]" >&2; exit 2; }
         speed=${4:-$([ "$cmd" = walk ] && echo 1.4 || echo 12)}
         run_all start --speed="$speed" --interval=1 "$(preset "$2")" "$(preset "$3")"
         echo "Moving $2 → $3 at $speed m/s (re-plans every ≥50 m, at most every 15 s)" ;;
  clear) run_all clear; echo "Simulated location cleared" ;;
  *) echo "usage: sim-gps.sh list|set|drive|walk|clear" >&2; exit 2 ;;
esac
