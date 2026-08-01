#!/usr/bin/env bash
set -euo pipefail

gcp_project="clawdbot-ks-2026"
gcp_zone="us-east1-b"
gcp_instance="clawdbot-vm"

gcloud compute ssh "$gcp_instance" --project "$gcp_project" --zone "$gcp_zone" --quiet \
  --command 'set -e; previous=$(sudo cat /opt/chat-h/previous-release); test -d "$previous"; current=$(readlink -f /opt/chat-h/current); sudo ln -sfn "$previous" /opt/chat-h/current; printf "%s\n" "$current" | sudo tee /opt/chat-h/previous-release >/dev/null; sudo systemctl restart chat-h-mcp chat-h-web; sudo systemctl is-active --quiet chat-h-mcp chat-h-web'

echo "VM services rolled back to the previous Chat-H release."
echo "Firebase Hosting is unchanged. Roll it back from the chat-h-prod-ks-2026 Hosting release history if required."
