# UK Mortgage Repayment MCP

Tool-only MCP server for estimating UK repayment mortgage payments in ChatGPT.

## Build and run locally (no ngrok)

You can develop and test both the MCP server and browser front end entirely on
your machine. No public URL or tunnel is needed.

### Prerequisites

- Node.js 22 or later (`node --version`)
- npm

Install the root dependencies once:

```bash
npm install
```

Install the front-end dependencies once:

```bash
cd test-client
npm install
cd ..
```

### 1. Start the MCP server

In the repository root, run:

```bash
npm run dev
```

The server listens at:

```text
http://localhost:8787/mcp
```

Use `PORT=9000 npm run dev` to choose a different port.

Leave this terminal running.

### 2. Start the local front end and chat API

Open a second terminal in the repository root and run:

```bash
cd test-client
npm run dev
```

This starts the browser UI on port `5173` and the local chat-orchestrator API
on port `5174`. The browser and orchestrator are local; generating chat
replies uses OpenRouter and needs your API key and internet access.

Before starting it, create `test-client/.env` if it does not already exist:

```dotenv
OPENROUTER_API_KEY=your_api_key
```

The protected local UI also needs hashed login credentials. Generate them
without writing the password itself to `.env`:

```bash
read -s CHAT_H_LOCAL_PASSWORD
CHAT_H_PASSWORD="$CHAT_H_LOCAL_PASSWORD" node scripts/create-auth-values.mjs >> test-client/.env
unset CHAT_H_LOCAL_PASSWORD
```

The generated username defaults to `hsbc`. Sign in with that username and the
password entered at the prompt.

Open [http://127.0.0.1:5173/](http://127.0.0.1:5173/). The default MCP
endpoint is `http://127.0.0.1:8787/mcp`. You can use both the chat composer
and the MCP **Connect** control.

### Direct MCP controls only (no chat)

If you specifically want to test only MCP JSON-RPC calls and do not need the
chat composer or an OpenRouter key, run this instead:

```bash
cd test-client
npm run dev:ui
```

Use the MCP **Connect** control in this mode to inspect the available server
tools. The chat composer requires the local port-`5174` API and will fail if
used with `dev:ui`. See the
[test-client README](test-client/README.md) for model and endpoint settings.

## Tools

`calculate_mortgage_repayment`

Inputs:

- `loanAmount`: mortgage loan amount in pounds sterling
- `annualInterestRatePercent`: nominal annual interest rate, for example `5.25`
- `termYears`: whole mortgage term in years
- `monthlyOverpayment`: optional extra monthly repayment in pounds sterling

Outputs include monthly payment, total paid, total interest, and overpayment impact when provided.

`find_mortgage_product_rates`

Inputs:

- `propertyValue`: property value in pounds sterling
- `loanAmount`: borrowing amount in pounds sterling
- `termYears`: mortgage term from 2 to 40 whole years
- `depositAmount`: optional; if supplied, it must equal property value minus borrowing

It generates illustrative 2/3/5-year fixed and 2-year tracker products from
the calculated LTV band. Each result includes the initial rate, monthly
repayment, product fee, estimated APRC, reversion rate, and maximum LTV. These
are deterministic demo calculations, not live rates, availability, eligibility,
or offers.

`mortgageNeed` is optional and defaults to `switch_residential`. The supported
values are `switch_residential`, `first_time_buyer`, `move_home`,
`remortgage`, `buy_to_let`, `remortgage_buy_to_let`, and
`switch_buy_to_let`. It records the selected customer journey; every journey
uses the same deterministic illustrative pricing algorithm.

`get_customer_support`

Inputs:

- `topic`: `general` (default) or `mortgage`

Outputs include official-source-linked HSBC UK contact options and phone
numbers. The values are a local snapshot for the test tool; use the returned
official contact page as the source of truth for current details and opening
hours. General support output also includes HSBC's contact/chat guidance and
online-banking links.

## Using ChatGPT developer mode

ChatGPT's hosted service cannot reach `127.0.0.1` or `localhost` on your
computer. Therefore, without a public HTTPS endpoint, use the local browser
client or MCP Inspector to develop and test the server. Connecting the MCP
directly to ChatGPT developer mode requires a publicly reachable HTTPS URL;
this repository does not require ngrok for local development.

## Verify

```bash
npm test
npm run build
npm run typecheck
```

You can also test the MCP endpoint with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector@latest --server-url http://localhost:8787/mcp --transport http
```

The calculation is an estimate for illustration only and is not financial advice.

## Private production deployment

The production deployment is isolated from the other applications on the
existing VM:

- UI: `https://chat-h-prod-ks-2026.web.app`
- protected API and MCP: `https://chat-h.35.211.52.83.nip.io`
- loopback services: `chat-h-mcp` on `127.0.0.1:8787` and `chat-h-web` on
  `127.0.0.1:5174`
- releases: `/opt/chat-h/releases/<release-id>` with `/opt/chat-h/current`
- secrets: `/etc/chat-h/app.env`, root-owned with mode `0600`

The public Firebase files contain only the login shell and application code.
The password is verified by the VM using a salted scrypt hash. A successful
login stores a signed 12-hour bearer token in the current tab's
`sessionStorage`; the password is never persisted. `/health`, `/chat`, and
`/mcp` all require that token.

### First deployment

The exact Firebase project must exist and be visible in
`firebase projects:list`. Create only this project ID; if it is unavailable,
stop rather than substituting another ID:

```bash
firebase projects:create chat-h-prod-ks-2026 --display-name "Chat-H Prod"
```

Record the existing applications' baseline, then deploy:

```bash
./scripts/preflight-existing.sh

export OPENROUTER_API_KEY='...'
export CHAT_H_USERNAME='hsbc'
export CHAT_H_PASSWORD='...'
./scripts/deploy-prod.sh
```

The deploy script runs all 14 MCP tests, typechecking, both builds, client
checks, and the authentication integration check. It then uploads a versioned
release, creates the dedicated system user and services, obtains the isolated
Let’s Encrypt certificate if needed, validates Nginx before reload, deploys
Firebase with the explicit `--project chat-h-prod-ks-2026` argument, and runs
the production smoke suite. It does not address another Firebase project or
restart an existing application service.

Run the smoke suite again at any time:

```bash
CHAT_H_USERNAME='hsbc' CHAT_H_PASSWORD='...' ./scripts/smoke-prod.sh
```

After deployment, repeat `./scripts/preflight-existing.sh` and compare its
service/listener output with the recorded baseline.

### Rollback

To switch only the VM services back to the previously deployed Chat-H release:

```bash
./scripts/rollback-prod.sh
```

Firebase Hosting has an independent release history. If its UI also needs to
be reverted, use the rollback action for the
`chat-h-prod-ks-2026` site in the Firebase Hosting console. Do not roll back
or redeploy WealthTrack, Pension Dashboard, or Stock Picker.

To disable Chat-H without touching another app:

```bash
gcloud compute ssh clawdbot-vm \
  --project clawdbot-ks-2026 --zone us-east1-b \
  --command 'sudo systemctl disable --now chat-h-mcp chat-h-web'
```
