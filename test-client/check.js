import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const files = [
  "src/app.js",
  "server.js",
  "auth.js",
  "auth.check.js",
  "server-auth.check.js",
  "dev.js",
];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

await import("./auth.check.js");

const {
  extractRepaymentDetails,
  getActiveMortgageWorkflow,
  getActiveWorkflowMessages,
  normalizeEndpoint,
} = await import("./server.js");

process.env.MCP_ENDPOINT_LOCKED = "true";
assert.equal(
  normalizeEndpoint("https://chat-h.35.211.52.83.nip.io/mcp"),
  "http://127.0.0.1:8787/mcp",
);
delete process.env.MCP_ENDPOINT_LOCKED;

const repaymentConversation = [
  { role: "user", content: "mortgage deals" },
  { role: "assistant", content: "Choose a mortgage journey." },
  { role: "user", content: "calculate repayment estimates" },
  { role: "assistant", content: "Please provide the repayment details." },
  {
    role: "user",
    content: "loan amount £200k, Annual interest rate 4.59%, term 10 years, overpayment £50",
  },
];

assert.equal(
  getActiveMortgageWorkflow(repaymentConversation, "switch_residential"),
  "repayment",
);
assert.deepEqual(
  extractRepaymentDetails(getActiveWorkflowMessages(repaymentConversation, "repayment")),
  {
    loanAmount: 200_000,
    annualInterestRatePercent: 4.59,
    termYears: 10,
    monthlyOverpayment: 50,
  },
);

const dealConversation = [
  ...repaymentConversation,
  { role: "user", content: "show me mortgage deals" },
];
assert.equal(
  getActiveMortgageWorkflow(dealConversation, "switch_residential"),
  "deals",
);

const styles = readFileSync(new URL("./src/styles.css", import.meta.url), "utf8");
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("./src/app.js", import.meta.url), "utf8");
assert.match(html, /id="login-screen"/);
assert.match(html, /id="app-shell" class="app-shell" hidden/);
assert.match(app, /sessionStorage\.setItem/);
assert.match(app, /authorization.*Bearer/);
assert.match(styles, /body \{[^}]*height: 100dvh;[^}]*overflow: hidden;/);
assert.match(styles, /\.side-panel \{[^}]*overflow-y: auto;/);
assert.match(
  styles,
  /@media \(max-width: 820px\) \{ body \{[^}]*overflow: auto;/,
);
