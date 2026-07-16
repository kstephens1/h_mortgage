# ChatHSBC Test Client

Standalone browser client for testing the local MCP server over Streamable HTTP.
Chat messages go through a local orchestrator that calls OpenRouter with
`xiaomi/mimo-v2-flash` and lets the model invoke approved MCP mortgage tools.

## Run

Start the MCP server from the repository root:

```bash
npm run dev
```

Then start the test client:

Create `test-client/.env` and add your OpenRouter API key:

```bash
OPENROUTER_API_KEY=your_api_key
```

Then start the client:

```bash
cd test-client
npm run dev
```

Open the Vite URL:

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
OPENROUTER_MAX_TOKENS=4096
MCP_ENDPOINT=http://127.0.0.1:8787/mcp
MCP_ALLOWED_TOOLS=calculate_mortgage_repayment,find_mortgage_product_rates
TEST_CLIENT_API_PORT=5174
```

The chat orchestrator uses `tools/list` to discover the allowed tool schemas at
the MCP endpoint. It currently supports repayment calculations and local,
illustrative mortgage-product-rate fixtures. The rate fixtures are not live
rates, product availability, eligibility decisions, or offers.

Selecting **HSBC Mortgages** from the chat `@` menu enables HSBC mode for the
current browser tab. In this mode, the assistant is limited to the discovered
HSBC MCP capabilities: it calls matching tools, asks for missing tool inputs,
or explains which supported actions are available. The selection remains after
sending a message until you delete the chip or refresh the page.

## Direct MCP Only

To run only the browser UI without the OpenRouter orchestrator:

```bash
npm run dev:ui
```

Then use the `Connect` and `Run Tool` buttons against:

```text
http://127.0.0.1:8787/mcp
```

The direct MCP controls use JSON-RPC calls to `initialize`, `tools/list`, and
`tools/call`. The chat composer uses `POST /chat` on the local orchestrator.
