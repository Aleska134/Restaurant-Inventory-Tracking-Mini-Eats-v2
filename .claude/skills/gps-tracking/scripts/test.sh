#!/usr/bin/env bash
# Run the pickup-timing unit tests (planner, ready-time model, routing fallback).
#   test.sh         PickupPlanningTests only
#   test.sh --all   every MiniEatsTests test
# Builds into ~/Library/Developer (not under the iCloud-synced Desktop, which breaks codesign).
set -euo pipefail
cd "$(dirname "$0")/../../../../ios"
only="-only-testing:MiniEatsTests/PickupPlanningTests"
[ "${1:-}" = "--all" ] && only="-only-testing:MiniEatsTests"
sim=${SIM_UDID:-$(xcrun simctl list devices available | grep -m1 -Eo 'iPhone[^(]*\(([0-9A-F-]{36})\)' | grep -Eo '[0-9A-F-]{36}')}
[ -n "$sim" ] || { echo "No iPhone Simulator available" >&2; exit 1; }
xcodebuild -project MiniEats.xcodeproj -scheme MiniEats \
  -destination "platform=iOS Simulator,id=$sim" \
  -derivedDataPath "$HOME/Library/Developer/Xcode/DerivedData/BarMade-gps-tests" \
  $only test 2>&1 | grep -E "error:|Test Case .*(passed|failed)|Executed [0-9]+ tests|TEST (SUCCEEDED|FAILED)" \
  | sed -E "s/Test Case '-\[MiniEatsTests\.//; s/\]' / /"
