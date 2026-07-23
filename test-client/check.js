import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const files = ["src/app.js", "server.js", "dev.js"];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const {
  extractRepaymentDetails,
  getActiveMortgageWorkflow,
  getActiveWorkflowMessages,
} = await import("./server.js");

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
assert.match(styles, /body \{[^}]*height: 100dvh;[^}]*overflow: hidden;/);
assert.match(styles, /\.side-panel \{[^}]*overflow-y: auto;/);
assert.match(
  styles,
  /@media \(max-width: 820px\) \{ body \{[^}]*overflow: auto;/,
);
