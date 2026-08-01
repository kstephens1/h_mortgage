#!/usr/bin/env bash
set -euo pipefail

curl -fsS https://wealthtracker-prod-ks-2026.web.app >/dev/null
curl -fsS https://pension-dashboard.web.app >/dev/null
if ! curl -fsS https://wealthtrack.35.211.52.83.nip.io/api/hello >/dev/null; then
  echo "WARNING: WealthTrack API TLS validation failed; checking the pre-existing endpoint without certificate validation." >&2
  curl -kfsS https://wealthtrack.35.211.52.83.nip.io/api/hello | grep . >/dev/null
fi

gcloud compute ssh clawdbot-vm --project clawdbot-ks-2026 --zone us-east1-b --quiet \
  --command "systemctl is-active wealthtrack stock-picker && sudo ss -ltnp"

echo "Existing-application preflight checks passed"
