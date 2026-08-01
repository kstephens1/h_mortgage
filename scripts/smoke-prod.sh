#!/usr/bin/env bash
set -euo pipefail

ui_url=${1:-https://chat-h-prod-ks-2026.web.app}
api_url=${2:-https://chat-h.35.211.52.83.nip.io}
: "${CHAT_H_USERNAME:=hsbc}"
: "${CHAT_H_PASSWORD:?Set CHAT_H_PASSWORD for the production smoke test}"

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

curl -fsS "$ui_url" > "$tmp_dir/index.html"
grep 'id="login-screen"' "$tmp_dir/index.html" >/dev/null
script_path=$(sed -n 's/.*src="\([^"]*\.js\)".*/\1/p' "$tmp_dir/index.html" | head -1)
[[ -n "$script_path" ]]
curl -fsS "${ui_url}${script_path}" > "$tmp_dir/app.js"
grep 'https://chat-h.35.211.52.83.nip.io' "$tmp_dir/app.js" >/dev/null
if grep 'http://127.0.0.1:8787/mcp' "$tmp_dir/app.js" >/dev/null; then
  echo "Production bundle contains the local MCP endpoint" >&2
  exit 1
fi
echo "UI login shell and production endpoints verified"

unauth_status=$(curl -sS -o /dev/null -w '%{http_code}' "$api_url/health")
[[ "$unauth_status" == "401" ]]
unauth_mcp_status=$(curl -sS -o /dev/null -w '%{http_code}' \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":0,"method":"tools/list","params":{}}' "$api_url/mcp")
[[ "$unauth_mcp_status" == "401" ]]
wrong_status=$(curl -sS -o /dev/null -w '%{http_code}' \
  -H 'content-type: application/json' \
  --data '{"username":"wrong","password":"wrong"}' "$api_url/auth/login")
[[ "$wrong_status" == "401" ]]
echo "Anonymous API/MCP rejection and wrong-login rejection verified"

login_payload=$(node -e 'process.stdout.write(JSON.stringify({username:process.env.CHAT_H_USERNAME,password:process.env.CHAT_H_PASSWORD}))')
curl -fsS -H 'content-type: application/json' --data "$login_payload" \
  "$api_url/auth/login" > "$tmp_dir/login.json"
token=$(node -e 'const x=require(process.argv[1]); if(!x.token) process.exit(1); process.stdout.write(x.token)' "$tmp_dir/login.json")
auth_header="Authorization: Bearer ${token}"

curl -fsS -H "$auth_header" "$api_url/health" | grep '"ok":true' >/dev/null
echo "Authenticated health check verified"

origin_headers=$(curl -fsSI -X OPTIONS \
  -H 'Origin: https://chat-h-prod-ks-2026.web.app' \
  -H 'Access-Control-Request-Method: POST' "$api_url/mcp")
grep -qi 'access-control-allow-origin: https://chat-h-prod-ks-2026.web.app' <<<"$origin_headers"
rejected_headers=$(curl -sSI -X OPTIONS \
  -H 'Origin: https://rejected.example' \
  -H 'Access-Control-Request-Method: POST' "$api_url/mcp")
if grep -qi 'access-control-allow-origin:' <<<"$rejected_headers"; then
  echo "Rejected origin unexpectedly received CORS access" >&2
  exit 1
fi
echo "Production and rejected CORS origins verified"

mcp_call() {
  local payload=$1
  curl -fsS -H "$auth_header" \
    -H 'content-type: application/json' \
    -H 'accept: application/json, text/event-stream' \
    --data "$payload" "$api_url/mcp"
}

mcp_call '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"prod-smoke","version":"1.0"}}}' \
  | grep '"serverInfo"' >/dev/null
mcp_call '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | grep '"calculate_mortgage_repayment"' >/dev/null
mcp_call '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"calculate_mortgage_repayment","arguments":{"loanAmount":200000,"annualInterestRatePercent":4.5,"termYears":25}}}' \
  | grep '"monthlyPayment"' >/dev/null
echo "MCP initialize, list, and tool call verified"

curl -fsS -H "$auth_header" -H 'content-type: application/json' \
  --data '{"messages":[{"role":"user","content":"calculate mortgage repayment, loan amount £200000, annual interest rate 4.5%, term 25 years"}],"hsbcMode":true,"mcpEndpoint":"https://chat-h.35.211.52.83.nip.io/mcp"}' \
  "$api_url/chat" | grep '"source":"mcp"' >/dev/null

echo "Production smoke tests passed for $ui_url and $api_url"
