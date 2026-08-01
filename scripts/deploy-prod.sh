#!/usr/bin/env bash
set -euo pipefail

firebase_project="chat-h-prod-ks-2026"
firebase_url="https://${firebase_project}.web.app"
api_url="https://chat-h.35.211.52.83.nip.io"
gcp_project="clawdbot-ks-2026"
gcp_zone="us-east1-b"
gcp_instance="clawdbot-vm"

: "${OPENROUTER_API_KEY:?Set OPENROUTER_API_KEY before deploying}"
: "${CHAT_H_USERNAME:=hsbc}"
: "${CHAT_H_PASSWORD:?Set CHAT_H_PASSWORD before deploying}"

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

firebase projects:list --json | node scripts/require-firebase-project.mjs "$firebase_project"
npm ci
npm --prefix test-client ci
npm test
npm run typecheck
npm run build
npm --prefix test-client run check
npm --prefix test-client run check:auth
VITE_API_BASE_URL="$api_url" VITE_MCP_ENDPOINT="${api_url}/mcp" npm --prefix test-client run build

release_id="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD)"
staging_dir=$(mktemp -d)
cleanup() {
  rm -rf "$staging_dir"
}
trap cleanup EXIT

install -d "$staging_dir/release/web" "$staging_dir/release/deploy"
cp package.json package-lock.json "$staging_dir/release/"
cp -R dist "$staging_dir/release/"
cp test-client/server.js test-client/auth.js "$staging_dir/release/web/"
cp deploy/* "$staging_dir/release/deploy/"
tar -czf "$staging_dir/${release_id}.tar.gz" -C "$staging_dir/release" .

CHAT_H_USERNAME="$CHAT_H_USERNAME" CHAT_H_PASSWORD="$CHAT_H_PASSWORD" \
  OPENROUTER_API_KEY="$OPENROUTER_API_KEY" node scripts/write-prod-env.mjs \
  "$staging_dir/app.env"
chmod 0600 "$staging_dir/app.env"

gcloud compute scp \
  "$staging_dir/${release_id}.tar.gz" "$staging_dir/app.env" scripts/install-release.sh \
  "${gcp_instance}:/tmp/" --project "$gcp_project" --zone "$gcp_zone" --quiet
gcloud compute ssh "$gcp_instance" --project "$gcp_project" --zone "$gcp_zone" --quiet \
  --command "sudo bash /tmp/install-release.sh '$release_id' '/tmp/${release_id}.tar.gz' /tmp/app.env"

firebase deploy --only hosting --project "$firebase_project"
CHAT_H_PASSWORD="$CHAT_H_PASSWORD" CHAT_H_USERNAME="$CHAT_H_USERNAME" \
  scripts/smoke-prod.sh "$firebase_url" "$api_url"

echo "Deployed $release_id"
echo "UI: $firebase_url"
echo "API: $api_url"
