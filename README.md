# UK Mortgage Repayment MCP

Tool-only MCP server for estimating UK repayment mortgage payments in ChatGPT.

## Run Locally

```bash
npm install
npm run dev
```

The server listens at:

```text
http://localhost:8787/mcp
```

Use `PORT=9000 npm run dev` to choose a different port.

## Tool

`calculate_mortgage_repayment`

Inputs:

- `loanAmount`: mortgage loan amount in pounds sterling
- `annualInterestRatePercent`: nominal annual interest rate, for example `5.25`
- `termYears`: whole mortgage term in years
- `monthlyOverpayment`: optional extra monthly repayment in pounds sterling

Outputs include monthly payment, total paid, total interest, and overpayment impact when provided.

## Connect To ChatGPT

For local development, expose the MCP server over HTTPS with a tunnel:

```bash
ngrok http 8787
```

Then add the app in ChatGPT developer mode using the HTTPS URL with `/mcp`, for example:

```text
https://example.ngrok.app/mcp
```

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
