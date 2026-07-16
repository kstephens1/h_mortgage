# Project State

## 2026-07-15
- Read `AGENTS.md` as requested.
- Created this state file because no prior `PROJECT_STATE.md` existed in the repository.
- Added `test-client/`, a standalone browser chat UI for testing the MCP server over Streamable HTTP.
- Added `test-client/README.md` with run instructions.
- Verification passed: `npm --prefix test-client run check`, `npm test`, `npm run typecheck`, and `npm run build`.
- Smoke checked the running Vite client at `http://127.0.0.1:5173/` and confirmed a direct `tools/call` request to `http://127.0.0.1:8787/mcp` returns the expected mortgage result.
- Discussed how to make the test client conversational by adding a model-backed chat orchestrator between the browser UI and MCP server; no code changes made for that yet.
- Implemented a local `test-client` chat orchestrator using the OpenAI Responses API with default model `gpt-5.6-terra`; the browser chat now posts to `/chat`, and the orchestrator calls the existing MCP mortgage tool when the model requests it.
- Set the Vite dev server to strict port `5173` so it cannot auto-increment onto the orchestrator API port `5174`.
- Verification passed after orchestrator work: `npm --prefix test-client run check`, `npm test`, `npm run typecheck`, and `npm run build`.
- Started the local test client stack: Vite UI on `http://127.0.0.1:5173/`, orchestrator API on `http://127.0.0.1:5174/`; `/health` reports `gpt-5.6-terra`, and `/chat` returns the expected missing-token error until `OPENAI_API_KEY` or `OPENAI_OAUTH_TOKEN` is provided.
- Clarified that local OpenAI API testing should normally use `OPENAI_API_KEY`; `OPENAI_OAUTH_TOKEN` is only useful if the user already has a valid bearer token from a specific OAuth flow.
- Clarified that an OpenAI API key is itself used as a Bearer credential for API requests; extracting ChatGPT/browser session tokens is unsupported and should not be used for this local test client.
- Provided restart guidance for running the local MCP server and test-client orchestrator with `OPENAI_OAUTH_TOKEN`; no code changes made.

## 2026-07-16
- Confirmed the local MCP server is already running on `http://127.0.0.1:8787/mcp`.
- A `GET /mcp` response returned the expected MCP `406 Not Acceptable` (the endpoint requires an MCP-compatible `Accept` header), confirming the listener is available. Starting a second `npm run dev` instance correctly failed with `EADDRINUSE`.
- Diagnosed a test-client OpenAI OAuth failure: the supplied bearer token lacks the required `api.responses.write` scope. The chat orchestrator needs this permission to call the Responses API; use a suitable API key or obtain a correctly scoped OAuth token with appropriate organization and project access.
- Replaced the test-client's OpenAI Responses API orchestrator with OpenRouter Chat Completions, retaining the MCP function-calling loop. The default is the tool-capable Xiaomi FP8 model `xiaomi/mimo-v2-flash` because `xiaomi/fp8` identifies a provider/quantization, not an OpenRouter model ID.
- Added gitignored `test-client/.env` with an `OPENROUTER_API_KEY` placeholder. `npm run dev` and `npm run dev:api` now load it automatically through Node's `--env-file` option.
- Updated `test-client/README.md` with OpenRouter setup and environment documentation.
- Verification passed: `node --check test-client/server.js`, `npm --prefix test-client run check`, `npm test`, `npm run typecheck`, and `npm run build`.
- Added `find_mortgage_product_rates` to the HSBC MCP server. It accepts loan amount, property value, and deposit amount; derives LTV; and returns matching, explicitly illustrative HSBC-style local rate fixtures. It validates that loan plus deposit equals property value and never presents fixtures as live rates, product availability, eligibility, or offers.
- Reworked the test-client orchestrator from a hardcoded repayment function into allowlisted `tools/list` discovery. It exposes live MCP tool descriptions and input schemas to OpenRouter and routes each approved model tool call back to the correct MCP tool. The default `MCP_ALLOWED_TOOLS` includes repayment and product-rate tools.
- Updated test-client environment documentation and local `.env` with the allowlist; updated chat copy to describe approved multi-tool support. The direct browser panel remains repayment-specific.
- Verification passed: `npm test`, `npm run typecheck`, `npm --prefix test-client run check`, `node --check test-client/server.js`, and `npm run build`.
- Diagnosed a rate-query routing failure as a stale MCP process: the updated test-client API was running, but port `8787` still advertised only `calculate_mortgage_repayment`. Restarted the local MCP dev server; `tools/list` now confirms both `calculate_mortgage_repayment` and `find_mortgage_product_rates` are available.
- Added response-source badges in the test client: any assistant reply backed by an MCP `toolResults` entry, including direct `Run Tool` replies, displays an HSBC Mortgages logo chip. Model-only/generic assistant replies remain unbadged.
- Verification passed: `node --check test-client/src/app.js`, `npm --prefix test-client run check`, `npm test`, `npm run typecheck`, and `npm run build`.
- Implemented HSBC-chip restricted chat mode. The browser preserves a selected HSBC chip across sends in the current tab, sends `hsbcMode` with each chat request, and only clears the selection when the chip is deleted (or on refresh).
- The orchestrator now uses a mode-specific system prompt built from the approved MCP tools. In HSBC mode it calls matching tools, requests only missing tool inputs, and otherwise provides a capability-limited response without unsupported mortgage guidance or invented contact details. `/chat` now returns `source` as `mcp`, `hsbc-guidance`, or `generic`; both HSBC sources are logo-badged in the UI.
- Updated the test-client README with HSBC-mode behaviour. Verification passed: `node --check test-client/src/app.js`, `node --check test-client/server.js`, `npm --prefix test-client run check`, `npm test`, `npm run typecheck`, and `npm run build`.
- Added safe GitHub-flavoured Markdown rendering for assistant replies with local `marked` and `dompurify` dependencies. User messages and errors remain plain text; assistant Markdown is sanitized to a limited allowlist before DOM insertion, with safe external-link attributes.
- Styled rendered headings, lists, quotes, code, separators, links, and horizontally scrollable tables so tool output no longer displays Markdown syntax literally. Updated the assistant prompt to request concise GFM Markdown without raw HTML.
- Verification passed: `node --check test-client/src/app.js`, `node --check test-client/server.js`, `npm --prefix test-client run check`, `npm --prefix test-client exec vite build`, `npm test`, `npm run typecheck`, and `npm run build`.
- Initialized this previously non-Git workspace for publication. Confirmed `test-client/.env` is ignored by `.gitignore`; dependency directories and build outputs are also excluded from the initial commit.
- Added an `@` mention selector to the test-client chat composer. Typing `@` opens a selectable **HSBC Mortgages** option; selecting it inserts an inline, non-editable HSBC-logo chip into the entry field while preserving the typed message text. Enter selects the option while the menu is open; Escape dismisses it.
- Reused `test-client/assets/hsbc-logo.png` for both the selector and selected chip. Verified static checks with `npm --prefix test-client run check` and `node --check test-client/src/app.js`; the running Vite server returned `200 OK` for the updated module and logo asset. In-app visual automation was unavailable because its browser connection could not initialize in this session.
- Fixed mention-chip deletion: the composer now detects when the HSBC chip has been removed, clears its selection state, and restores the default “Ask about a mortgage, or type @ to add HSBC Mortgages” placeholder even if the browser leaves an empty line-break node. Typing `@` again now reopens the selector.
- Verification passed: `node --check test-client/src/app.js`, `npm --prefix test-client run check`, `npm test`, `npm run typecheck`, and `npm run build`.
- Diagnosed an OpenRouter credit-limit response when using `xiaomi/mimo-v2.5`: without an explicit completion-token cap, the provider reserves the model maximum of 65,536 tokens, which exceeds the key's remaining-credit allowance of 49,119 tokens. Set a lower `max_tokens` value in the client request to run within the key's limit.
- Added configurable `OPENROUTER_MAX_TOKENS`, defaulting to `4096`, and send it as `max_tokens` on OpenRouter Chat Completions requests. Added `OPENROUTER_MAX_TOKENS=4096` to the local gitignored `test-client/.env` and documented it in the README.
- Verification passed: `node --check test-client/server.js`, `npm --prefix test-client run check`, `npm test`, `npm run typecheck`, and `npm run build`.
