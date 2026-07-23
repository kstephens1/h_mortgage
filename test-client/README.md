# ChatHSBC Test Client

Standalone browser client for testing the local MCP server over Streamable HTTP.
Chat messages go through a local orchestrator that calls OpenRouter with
`xiaomi/mimo-v2-flash`. Chat is general-purpose by default; adding the
**HSBC Mortgages** chip explicitly enables its approved MCP mortgage tools.

## Run locally (no tunnel)

Start the full local stack with the commands below. This runs the MCP server,
browser UI, and chat-orchestrator API on your machine; no ngrok or public URL
is required. Chat replies use OpenRouter, so `test-client/.env` must contain
your API key.

Install dependencies once from the repository root and from this directory:

```bash
npm install
cd test-client
npm install
```

Start the MCP server from the repository root:

```bash
npm run dev
```

Create `test-client/.env` if it does not already exist:

```bash
OPENROUTER_API_KEY=your_api_key
```

In a second terminal, start the UI and local chat orchestrator together:

```bash
cd test-client
npm run dev
```

Open the browser UI:

```text
http://127.0.0.1:5173/
```

The default MCP endpoint is:

```text
http://127.0.0.1:8787/mcp
```

## Environment

```bash
OPENROUTER_API_KEY=your_api_key
OPENROUTER_MODEL=xiaomi/mimo-v2-flash
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_MAX_TOKENS=2048
MCP_ENDPOINT=http://127.0.0.1:8787/mcp
MCP_ALLOWED_TOOLS=calculate_mortgage_repayment,find_mortgage_product_rates,get_customer_support
TEST_CLIENT_API_PORT=5174
```

`OPENROUTER_MAX_TOKENS` is the preferred completion ceiling. If OpenRouter
reports that the current balance can afford fewer tokens, the orchestrator
automatically retries once at 90% of the provider-reported affordable limit.

The chat orchestrator uses `tools/list` to discover the allowed tool schemas at
the MCP endpoint. It currently supports repayment calculations and local,
illustrative mortgage-product rates. Ask for a deal search in HSBC mode and
provide property value, borrowing amount, and mortgage term; product cards are
rendered in the conversation. Results are not live rates, product availability,
eligibility decisions, or offers.

Without an app chip, chat is general-purpose and the model receives no HSBC
MCP tools. Selecting **HSBC Mortgages** from the chat `@` menu enables HSBC
mode for the current browser tab. In this mode, the assistant is limited to
the discovered HSBC MCP capabilities: it calls matching tools, asks for
missing tool inputs, or explains which supported actions are available. Any
non-mortgage question receives that HSBC-only capability response; it cannot
fall back to general-purpose chat while the chip remains selected. The
selection remains after sending a message until you delete the chip or refresh
the page.

In HSBC mode, requests for a mortgage decision, decision in principle, AIP, or
DIP display a **Get a decision in principle** button. It opens HSBC's decision
in principle page in a new tab.

Asking HSBC-mode chat to find mortgage deals first displays seven selectable
customer journeys. After choosing one, provide property value, borrowing
amount, and mortgage term; the same illustrative rate algorithm is used for
every journey and the resulting deal sheets appear in the conversation.

Repayment-estimate requests are routed directly to
`calculate_mortgage_repayment`, even if a mortgage journey was selected
earlier. Provide the loan amount, annual interest rate, term, and optional
monthly overpayment. The text response echoes those inputs and shows the
standard monthly repayment and total interest; when an overpayment is present,
it also shows the adjusted monthly amount, total interest, interest saved, and
time saved.

In HSBC mode, the standalone phrase **“I need help”** always returns a
deterministic summary of every local HSBC capability. Explicit phrases such as
**“contact HSBC”** and **“contact the bank”** call the `get_customer_support`
MCP tool directly without OpenRouter. The stable response includes published
phone numbers, online/mobile chat instructions, and official HSBC contact and
online-banking links. Those details are a local snapshot: use the returned
official links to confirm current availability and opening hours. All website
links open in a new tab. General chat remains tool-free.

For the `switch_residential` journey, each product card's **Switch your deal**
action opens HSBC's existing-customer mortgage-switching page in a new tab.

On desktop, the chat transcript scrolls independently while the **Connection**
and **Last Result** inspector cards remain in place. At widths of 820px and
below, the inspector stays below the chat in the normal page flow.

## Direct MCP Only

Use this narrower mode only when you want to inspect the MCP connection and
available tools without chat or OpenRouter. It starts only the browser UI, not
the chat-orchestrator API:

```bash
npm run dev:ui
```

Then use the `Connect` button against:

```text
http://127.0.0.1:8787/mcp
```

The connection control uses JSON-RPC calls to `initialize` and `tools/list`.
The chat composer uses `POST /chat` on the local orchestrator. Do not submit a
chat message in this mode: it will fail with `ECONNREFUSED` because port `5174`
is not running.
